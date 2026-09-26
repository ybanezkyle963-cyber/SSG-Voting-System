#!/usr/bin/env node
/**
 * Backend smoke test: runs an entire election against a throwaway server.
 *
 * Boots `server/index.js` on a fresh, temporary SQLite database (SSG_DATA_DIR,
 * never the project's real one), then drives it over HTTP the way a voter and
 * the committee would:
 *
 *   status -> bad login rejected -> voter signs in -> ballot paper sane ->
 *   server-side validation (unknown candidate, overvote) -> seal a ballot ->
 *   double-vote blocked -> receipt verifiable -> results gated until published
 *   -> published results sane -> audit chain reconciles.
 *
 * Exits 0 only if every check passes. No dependencies; Node 22.5+.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4390;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body is fine; tests read status */
  }
  return { status: res.status, json };
}

async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await call('GET', '/api/status');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}

/* ------------------------------------------------------------------- boot */

const dataDir = mkdtempSync(join(tmpdir(), 'ssg-smoke-'));
let server;
let exitCode = 1;

try {
  console.log('Seeding a fresh database...');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['seed.js'], {
      cwd: here,
      env: { ...process.env, SSG_DATA_DIR: dataDir, PORT: String(PORT) },
      stdio: 'inherit'
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    child.on('error', reject);
  });

  console.log(`Booting the server on :${PORT} (data: ${dataDir})`);
  server = spawn(process.execPath, ['index.js'], {
    cwd: here,
    env: { ...process.env, SSG_DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (c) => process.stderr.write(`[server] ${c}`));

  const up = await waitForServer();
  if (!up) throw new Error('server never answered');
  console.log('Running the election...\n');

  /* --------------------------------------------------------------- checks */

  const status = await call('GET', '/api/status');
  check('status answers with turnout', status.status === 200 && typeof status.json.turnout === 'object');
  check('fresh roster is 180 voters', status.json.turnout?.registered === 180);

  const bad = await call('POST', '/api/login', { body: { studentNo: '2026-1000', accessCode: 'WRONG' } });
  check('bad login is rejected', bad.status === 401);

  const voter = await call('POST', '/api/login', {
    body: { studentNo: '2026-1000', accessCode: 'DEMO01' }
  });
  check('voter signs in', voter.status === 200 && typeof voter.json.token === 'string');
  const vt = voter.json.token;

  const paper = await call('GET', '/api/ballot', { token: vt });
  check('ballot paper lists 7 posts', paper.status === 200 && paper.json.positions?.length === 7);
  const president = paper.json.positions.find((p) => p.id === 'president');
  const reps = paper.json.positions.find((p) => p.id === 'representatives');
  check('president is instant-runoff with 3 candidates',
    president?.method === 'irv' && president?.candidates?.length === 3);
  check('representatives is approval with 4 seats',
    reps?.method === 'approval' && reps?.seats === 4);

  const unknown = await call('POST', '/api/vote', {
    token: vt,
    body: { choices: { president: ['made-up-id'] } }
  });
  check('unknown candidate is rejected server-side', unknown.status === 400);

  const overvote = await call('POST', '/api/vote', {
    token: vt,
    body: { choices: { representatives: reps.candidates.map((c) => c.id).slice(0, 5) } }
  });
  check('approval overvote is rejected', overvote.status === 400);

  const choices = Object.fromEntries(
    paper.json.positions.map((p, i) => [
      p.id,
      p.method === 'irv'
        ? p.candidates.slice(0, (i % 2) + 1).map((c) => c.id) // rank 1 or 2
        : p.candidates.slice(0, 2).map((c) => c.id)           // approve 2
    ])
  );
  const seal = await call('POST', '/api/vote', { token: vt, body: { choices } });
  check('ballot seals with a serial and receipt',
    seal.status === 201 && seal.json.serial && seal.json.receipt?.length === 32);

  const again = await call('POST', '/api/vote', { token: vt, body: { choices } });
  check('second vote with a consumed session is rejected', again.status === 401);

  // The real guard: seal the session away, sign in again, and try once more.
  const voter2 = await call('POST', '/api/login', {
    body: { studentNo: '2026-1000', accessCode: 'DEMO01' }
  });
  check('a voter who has voted can still sign in', voter2.status === 200);
  const again2 = await call('POST', '/api/vote', { token: voter2.json.token, body: { choices } });
  check('double vote is blocked after re-signing in', again2.status === 409);

  const verify = await call('POST', '/api/verify', { body: { receipt: seal.json.receipt } });
  check('receipt verifies against the box', verify.json.found === true && verify.json.serial === seal.json.serial);

  const after = await call('GET', '/api/status');
  check('turnout reconciles after sealing', after.json.turnout?.voted === 1 && after.json.turnout?.sealed === 1 && after.json.turnout?.reconciled === true);

  const gated = await call('GET', '/api/results');
  check('results are gated before publication', gated.status === 403);

  const committee = await call('POST', '/api/login', {
    body: { studentNo: 'COMELEC-01', accessCode: 'ADMIN01' }
  });
  check('committee signs in', committee.status === 200 && committee.json.role === 'committee');
  const ct = committee.json.token;

  const closed = await call('GET', '/api/results', { token: ct });
  check('committee can see unpublished results', closed.status === 200 && closed.json.results?.length === 7);

  const publish = await call('POST', '/api/admin/election', { token: ct, body: { publishResults: true } });
  check('committee can publish', publish.status === 200 && publish.json.resultsPublished === true);

  const results = await call('GET', '/api/results');
  check('published results are public and counted', results.status === 200 && results.json.results?.every((r) => r.ballotsCast === 1));
  const pres = results.json.results.find((r) => r.positionId === 'president');
  check('instant-runoff produces a winner or declared tie', pres?.winners?.length === 1 || Array.isArray(pres?.tie));

  const audit = await call('GET', '/api/admin/audit', { token: ct });
  check('audit chain verifies', audit.json.chain?.ok === true && audit.json.chain?.entries > 0);
  // The promise is specific: ballot-sealed entries never say who sealed.
  const sealedEntries = audit.json.entries.filter((e) => e.event === 'ballot.sealed');
  check('audit never records who sealed',
    sealedEntries.length > 0 && sealedEntries.every((e) => !e.detail.includes('2026-1000')));

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  exitCode = failures.length ? 1 : 0;
} catch (err) {
  console.error(`\nsmoke test crashed: ${err.message}`);
  exitCode = 1;
} finally {
  if (server && !server.killed) server.kill();
  // Let the killed child settle so libuv does not abort during teardown.
  await new Promise((r) => setTimeout(r, 150));
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the file a moment; the temp dir is disposable */
  }
}

process.exit(exitCode);
