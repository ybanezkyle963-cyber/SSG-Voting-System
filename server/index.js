import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, sha256, rand, audit, verifyAuditChain, setting, setSetting, tx } from './db.js';
import { instantRunoff, approval } from './tally.js';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', 'web');
const PORT = process.env.PORT || 4000;
const SESSION_HOURS = 2;

/* ------------------------------------------------------------------ helpers */

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  const chunks = [];
  for await (const c of req) {
    chunks.push(c);
    if (chunks.reduce((n, b) => n + b.length, 0) > 64_000) throw new Error('payload too large');
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function currentUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token, s.role, v.student_no, v.full_name, v.year_level, v.has_voted
         FROM sessions s JOIN voters v ON v.student_no = s.student_no
        WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString());
  return row || null;
}

const electionOpen = () => setting('election_open', '1') === '1';

function ballotPaper() {
  const positions = db.prepare('SELECT * FROM positions ORDER BY sort_order').all();
  const candidates = db.prepare('SELECT * FROM candidates ORDER BY sort_order').all();
  return positions.map((p) => ({
    id: p.id,
    title: p.title,
    seats: p.seats,
    method: p.method,
    candidates: candidates
      .filter((c) => c.position_id === p.id)
      .map(({ id, name, party, year_level, platform }) => ({
        id,
        name,
        party,
        yearLevel: year_level,
        platform
      }))
  }));
}

function turnout() {
  const total = db.prepare(`SELECT COUNT(*) n FROM voters WHERE role = 'voter'`).get().n;
  const voted = db.prepare(`SELECT COUNT(*) n FROM voters WHERE role = 'voter' AND has_voted = 1`).get().n;
  const sealed = db.prepare('SELECT COUNT(*) n FROM ballots').get().n;
  return {
    registered: total,
    voted,
    sealed,
    percent: total ? +((voted / total) * 100).toFixed(1) : 0,
    reconciled: voted === sealed
  };
}

/**
 * Rejects a ballot before it is sealed. Every rule is enforced here, on the
 * server, because the browser is not a trustworthy place to enforce anything.
 */
function validateChoices(choices) {
  const paper = ballotPaper();
  const clean = {};
  for (const post of paper) {
    const picked = choices?.[post.id] ?? [];
    if (!Array.isArray(picked)) return { error: `Malformed entry for ${post.title}.` };
    const valid = new Set(post.candidates.map((c) => c.id));
    if (picked.some((id) => !valid.has(id))) return { error: `Unknown candidate for ${post.title}.` };
    if (new Set(picked).size !== picked.length) return { error: `Repeated candidate for ${post.title}.` };
    if (post.method === 'approval' && picked.length > post.seats) {
      return { error: `${post.title} allows at most ${post.seats} choices.` };
    }
    clean[post.id] = picked; // an empty array is a recorded abstention, not an error
  }
  return { clean };
}

/* ------------------------------------------------------------------- routes */

const routes = {
  'POST /api/login': async (req, res) => {
    const { studentNo, accessCode } = await readJson(req);
    const voter = db
      .prepare('SELECT * FROM voters WHERE student_no = ?')
      .get(String(studentNo || '').trim());

    if (!voter || voter.access_code !== String(accessCode || '').trim()) {
      audit('login.rejected', { studentNo });
      return json(res, 401, { error: 'That student number and access code do not match our roster.' });
    }

    const token = rand(24);
    const now = new Date();
    db.prepare('INSERT INTO sessions (token, student_no, role, created_at, expires_at) VALUES (?,?,?,?,?)').run(
      token,
      voter.student_no,
      voter.role,
      now.toISOString(),
      new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString()
    );
    audit('login.accepted', { studentNo: voter.student_no, role: voter.role });

    json(res, 200, {
      token,
      role: voter.role,
      name: voter.full_name,
      yearLevel: voter.year_level,
      hasVoted: !!voter.has_voted
    });
  },

  'GET /api/status': (req, res) =>
    json(res, 200, {
      open: electionOpen(),
      resultsPublished: setting('results_published', '0') === '1',
      turnout: turnout()
    }),

  'GET /api/ballot': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to view the ballot.' });
    json(res, 200, { positions: ballotPaper(), open: electionOpen(), hasVoted: !!user.has_voted });
  },

  'POST /api/vote': async (req, res) => {
    const user = currentUser(req);
    if (!user || user.role !== 'voter') return json(res, 401, { error: 'Sign in to vote.' });
    if (!electionOpen()) return json(res, 409, { error: 'Voting is closed.' });
    if (user.has_voted) return json(res, 409, { error: 'Our roster already records a ballot for you.' });

    const { choices } = await readJson(req);
    const { clean, error } = validateChoices(choices);
    if (error) return json(res, 400, { error });

    const serial = rand(6).toUpperCase();
    const sealedAt = new Date().toISOString();
    const payload = JSON.stringify(clean);
    const receipt = sha256(`${serial}|${payload}|${sealedAt}`).slice(0, 32);

    // One transaction: the roster is marked and the ballot is sealed together,
    // so a crash can never produce a counted voter with no ballot, or the reverse.
    const seal = () => tx(() => {
      const claimed = db
        .prepare(`UPDATE voters SET has_voted = 1, voted_at = ? WHERE student_no = ? AND has_voted = 0`)
        .run(sealedAt, user.student_no);
      if (claimed.changes !== 1) throw new Error('double-vote blocked');
      db.prepare('INSERT INTO ballots (serial, receipt, choices_json, sealed_at) VALUES (?,?,?,?)').run(
        serial,
        receipt,
        payload,
        sealedAt
      );
    });

    try {
      seal();
    } catch {
      return json(res, 409, { error: 'Our roster already records a ballot for you.' });
    }

    // The log records that a ballot was sealed. It never records by whom.
    audit('ballot.sealed', { serial, receipt });
    db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);

    json(res, 201, { serial, receipt, sealedAt });
  },

  'GET /api/receipts': (req, res) =>
    json(res, 200, {
      receipts: db.prepare('SELECT receipt, sealed_at FROM ballots ORDER BY sealed_at').all()
    }),

  'POST /api/verify': async (req, res) => {
    const { receipt } = await readJson(req);
    const row = db.prepare('SELECT serial, sealed_at FROM ballots WHERE receipt = ?').get(String(receipt || '').trim());
    json(res, 200, row ? { found: true, ...row } : { found: false });
  },

  'GET /api/results': (req, res) => {
    const user = currentUser(req);
    const published = setting('results_published', '0') === '1';
    if (!published && user?.role !== 'committee') {
      return json(res, 403, { error: 'Results are released once voting closes.' });
    }
    json(res, 200, computeResults());
  },

  'POST /api/admin/election': async (req, res) => {
    const user = currentUser(req);
    if (user?.role !== 'committee') return json(res, 403, { error: 'Committee sign-in required.' });
    const { open, publishResults } = await readJson(req);
    if (open !== undefined) {
      setSetting('election_open', open ? '1' : '0');
      audit(open ? 'election.opened' : 'election.closed', { by: user.student_no });
    }
    if (publishResults !== undefined) {
      setSetting('results_published', publishResults ? '1' : '0');
      audit('results.published', { by: user.student_no, published: !!publishResults });
    }
    json(res, 200, { open: electionOpen(), resultsPublished: setting('results_published', '0') === '1' });
  },

  'GET /api/admin/audit': (req, res) => {
    const user = currentUser(req);
    if (user?.role !== 'committee') return json(res, 403, { error: 'Committee sign-in required.' });
    json(res, 200, {
      chain: verifyAuditChain(),
      entries: db.prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 100').all(),
      turnout: turnout()
    });
  }
};

function computeResults() {
  const paper = ballotPaper();
  const ballots = db.prepare('SELECT choices_json FROM ballots').all().map((b) => JSON.parse(b.choices_json));
  const names = new Map(
    db.prepare('SELECT id, name, party FROM candidates').all().map((c) => [c.id, c])
  );

  const results = paper.map((post) => {
    const cast = ballots.map((b) => b[post.id] ?? []);
    const abstentions = cast.filter((c) => c.length === 0).length;
    const ids = post.candidates.map((c) => c.id);
    const outcome =
      post.method === 'irv' ? instantRunoff(cast, ids) : approval(cast, ids, post.seats);

    const label = (id) => ({ id, name: names.get(id)?.name, party: names.get(id)?.party });
    return {
      positionId: post.id,
      title: post.title,
      seats: post.seats,
      method: post.method,
      abstentions,
      ballotsCast: cast.length,
      winners: outcome.winners.map(label),
      tie: outcome.tie ? outcome.tie.map(label) : null,
      rounds: outcome.rounds?.map((r) => ({
        ...r,
        counts: r.counts.map((c) => ({ ...c, ...label(c.candidateId) })),
        eliminated: r.eliminated?.map(label) ?? null
      })),
      standing: outcome.standing?.map((c) => ({ ...c, ...label(c.candidateId) }))
    };
  });

  return { turnout: turnout(), chain: verifyAuditChain(), results };
}

/* ------------------------------------------------------------ static + boot */

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(webRoot, rel));
    res.writeHead(200, { 'content-type': mime[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return serveStatic(req, res);
  try {
    await handler(req, res);
  } catch (err) {
    json(res, 400, { error: err.message || 'Request could not be processed.' });
  }
}).listen(PORT, () => {
  console.log(`SSG election server running at http://localhost:${PORT}`);
});
