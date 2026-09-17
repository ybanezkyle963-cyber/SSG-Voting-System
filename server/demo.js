/**
 * Fills the ballot box with random votes so you can show the results screen
 * without recruiting 140 classmates. Run the server first, then:
 *   node demo.js [count]
 */
import { db } from './db.js';

const BASE = process.env.BASE || 'http://localhost:4000';
const want = Number(process.argv[2] || 140);

const voters = db
  .prepare(`SELECT student_no, access_code FROM voters WHERE role='voter' AND has_voted=0 LIMIT ?`)
  .all(want);

if (!voters.length) {
  console.log('Everyone on the roster has already voted. Run `node seed.js` to start over.');
  process.exit(0);
}

const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const post = (path, body, token) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  }).then((r) => r.json().then((j) => [r.status, j]));

const [, paper] = await post('/api/login', { studentNo: voters[0].student_no, accessCode: voters[0].access_code });
const positions = await fetch(BASE + '/api/ballot', { headers: { authorization: `Bearer ${paper.token}` } })
  .then((r) => r.json())
  .then((d) => d.positions);

let cast = 0;
for (const v of voters) {
  const [, session] = await post('/api/login', { studentNo: v.student_no, accessCode: v.access_code });
  if (!session.token) continue;
  const choices = {};
  for (const p of positions) {
    const ids = p.candidates.map((c) => c.id);
    if (Math.random() < 0.06) { choices[p.id] = []; continue; }        // abstentions
    choices[p.id] =
      p.method === 'approval'
        ? shuffle(ids).slice(0, 1 + Math.floor(Math.random() * p.seats))
        : shuffle(ids).slice(0, 1 + Math.floor(Math.random() * ids.length));
  }
  const [status] = await post('/api/vote', { choices }, session.token);
  if (status === 201) cast += 1;
}

console.log(`Cast ${cast} demo ballots. Open the committee view to see the count.`);
