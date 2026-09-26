#!/usr/bin/env node
/**
 * Backend smoke test for the NestJS API.
 *
 * Requires a reachable Postgres (DATABASE_URL / POSTGRES_URL in the
 * environment or .env.local). Boots the compiled API on a spare port and runs
 * an entire election over HTTP against it:
 *
 *   status -> bad login rejected -> voter signs in -> ballot paper sane ->
 *   server-side validation -> seal -> double-vote blocked -> receipt verifies
 *   -> turnout reconciles -> results gated -> publish -> results public ->
 *   audit chain intact -> ballot entries never name a voter.
 *
 * Exits 0 only if every check passes.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const apiDir = join(root, 'api')
const apiEntry = join(apiDir, 'dist', 'index.js')
const envFile = join(root, '.env.local')

const env = { ...process.env, PORT: '4390' }
for (const loc of [envFile]) {
  if (existsSync(loc)) {
    for (const line of readFileSync(loc, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

if (!existsSync(apiEntry)) {
  console.error('api/dist is missing. Build first:  cd api && npm run build')
  process.exit(1)
}
if (!env.POSTGRES_URL && !env.DATABASE_URL) {
  console.error('No Postgres credentials found. Run:  npx vercel env pull .env.local')
  process.exit(1)
}

const PORT = 4390
const BASE = `http://localhost:${PORT}`

let passed = 0
const failures = []
function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ok  ${name}`)
  } else {
    failures.push(name)
    console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`)
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
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON body is fine; tests read status */
  }
  return { status: res.status, json }
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await call('GET', '/api/status')
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  return false
}

const server = spawn(process.execPath, [apiEntry], {
  cwd: apiDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
server.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`))

let exitCode = 1
try {
  const up = await waitForServer()
  if (!up) throw new Error('the API never answered on :4390')
  console.log('Running the election...\n')

  const status = await call('GET', '/api/status')
  check('status answers with turnout', status.status === 200 && typeof status.json.turnout === 'object')

  const bad = await call('POST', '/api/login', { body: { studentNo: 'admin', accessCode: 'WRONG' } })
  check('bad login is rejected', bad.status === 401)

  const committee = await call('POST', '/api/login', { body: { studentNo: 'admin', accessCode: 'admin' } })
  check('admin/admin signs in as committee', committee.status === 200 && committee.json.role === 'committee')
  const ct = committee.json.token

  const noAuthResults = await call('GET', '/api/results')
  check('results gated when unpublished', noAuthResults.status === 403)

  const voter = await call('POST', '/api/login', {
    body: { studentNo: process.env.SMOKE_VOTER ?? '2026-1000', accessCode: process.env.SMOKE_CODE ?? 'DEMO01' }
  })
  check('voter signs in', voter.status === 200 && typeof voter.json.token === 'string')
  const vt = voter.json.token

  const paper = await call('GET', '/api/ballot', { token: vt })
  check('ballot paper lists 7 posts', paper.status === 200 && paper.json.positions?.length === 7)
  const president = paper.json.positions.find((p) => p.id === 'president')
  const reps = paper.json.positions.find((p) => p.id === 'representatives')
  check('president is instant-runoff with 3 candidates',
    president?.method === 'irv' && president?.candidates?.length === 3)
  check('representatives is approval with 4 seats',
    reps?.method === 'approval' && reps?.seats === 4)

  const unknown = await call('POST', '/api/vote', {
    token: vt,
    body: { choices: { president: ['made-up-id'] } }
  })
  check('unknown candidate is rejected server-side', unknown.status === 400)

  const overvote = await call('POST', '/api/vote', {
    token: vt,
    body: { choices: { representatives: reps.candidates.map((c) => c.id).slice(0, 5) } }
  })
  check('approval overvote is rejected', overvote.status === 400)

  const choices = Object.fromEntries(
    paper.json.positions.map((p, i) => [
      p.id,
      p.method === 'irv'
        ? p.candidates.slice(0, (i % 2) + 1).map((c) => c.id)
        : p.candidates.slice(0, 2).map((c) => c.id)
    ])
  )
  const seal = await call('POST', '/api/vote', { token: vt, body: { choices } })
  check('ballot seals with a serial and receipt',
    seal.status === 201 && seal.json.serial && seal.json.receipt?.length === 32)

  const again = await call('POST', '/api/vote', { token: vt, body: { choices } })
  check('second vote with a consumed session is rejected', again.status === 401)

  const voter2 = await call('POST', '/api/login', {
    body: { studentNo: '2026-1000', accessCode: 'DEMO01' }
  })
  const again2 = await call('POST', '/api/vote', { token: voter2.json.token, body: { choices } })
  check('double vote is blocked after re-signing in', again2.status === 409)

  const verify = await call('POST', '/api/verify', { body: { receipt: seal.json.receipt } })
  check('receipt verifies against the box', verify.json.found === true && verify.json.serial === seal.json.serial)

  const after = await call('GET', '/api/status')
  check('turnout stays reconciled', after.json.turnout?.reconciled === true)

  const closed = await call('GET', '/api/results', { token: ct })
  check('committee can see unpublished results', closed.status === 200 && closed.json.results?.length === 7)

  const publish = await call('POST', '/api/admin/election', { token: ct, body: { publishResults: true } })
  check('committee can publish', publish.status === 200 && publish.json.resultsPublished === true)

  const results = await call('GET', '/api/results')
  check('published results are public', results.status === 200)
  const pres = results.json.results.find((r) => r.positionId === 'president')
  check('instant-runoff produces a winner or declared tie', pres?.winners?.length === 1 || Array.isArray(pres?.tie))

  const audit = await call('GET', '/api/admin/audit', { token: ct })
  check('audit chain verifies', audit.json.chain?.ok === true && audit.json.chain?.entries > 0)
  const sealedEntries = audit.json.entries.filter((e) => e.event === 'ballot.sealed')
  check('audit never records who sealed',
    sealedEntries.length > 0 && sealedEntries.every((e) => !e.detail.includes('2026-1000')))

  // Cleanup: this may run against a real database, so leave the results
  // unpublished (the sealed test ballot stays, which the roster reconciles).
  await call('POST', '/api/admin/election', { token: ct, body: { publishResults: false } })

  console.log(`\n${passed} checks passed, ${failures.length} failed`)
  exitCode = failures.length ? 1 : 0
} catch (err) {
  console.error(`\nsmoke test crashed: ${err.message}`)
  exitCode = 1
} finally {
  if (server && !server.killed) server.kill()
  await new Promise((r) => setTimeout(r, 150))
}

process.exit(exitCode)
