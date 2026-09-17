# SSG Election System

A working voting system for electing Supreme Student Government officers, built around one question: **after the count, can anyone actually show that the result is right?**

Most school voting apps answer "trust us." This one answers with a roster that reconciles against the ballot box, a log that breaks visibly if edited, a receipt every voter can check, and a counting rule that is published, deterministic, and re-runnable by anyone.

---

## Run it

Needs Node 22.5 or newer. No `npm install` — there are no dependencies.

```bash
cd server
node seed.js      # creates the database, 180 sample voters, 7 posts, 20 candidates
node index.js     # serves the API and the site at http://localhost:4000
node demo.js 140  # optional: casts random ballots so the results screen has data
```

Sign in with:

| Role | Student number | Access code |
|---|---|---|
| Voter | `2026-1000` | `DEMO01` |
| Voter | `2026-1001` | `DEMO02` |
| Committee | `COMELEC-01` | `ADMIN01` |

Other seeded voters get random codes; read them from the `voters` table.

---

## What makes the result more accurate

### 1. The winner is the one a majority prefers

Plurality ("highest number of votes wins") is where most SSG elections lose accuracy. With three serious candidates, someone can win the presidency on 36% while 64% of the school preferred either of the others. Vote-splitting punishes voters for having two candidates they like.

**Single-seat posts use instant runoff.** You rank as many candidates as you want. First choices are counted; if nobody clears half, the last-placed candidate is dropped and their ballots move to each voter's next surviving choice. Repeat until someone has a majority of the ballots still counting. Voting for your true favourite can never help your least favourite.

**Multi-seat posts (Representatives) use approval voting.** Mark everyone you would be content to see elected, up to the number of seats. Highest totals fill the seats. It is easy to explain, easy to count, and stops a single bloc from sweeping every seat on a plurality.

Both counters live in `server/tally.js` as pure functions. Same ballots in, same result out, every time — which means a protest can be settled by re-running the count rather than by argument.

### 2. Abstention is a recorded choice, not a missing one

Leaving a post blank is allowed and counted. The results screen reports abstentions per post. A post where 40% of voters abstained is important information about the candidates, and most systems silently discard it.

### 3. Ties are declared, never quietly broken

If the count ends level, the system returns a tie and refuses to name a winner. It surfaces the tied names and points to the written rule (drawing lots before the committee). No hidden tie-break by alphabetical order or database row order.

### 4. The roster and the ballot box must reconcile

Two independent numbers: how many students the roster marks as having voted, and how many sealed ballots exist. The committee dashboard shows both. If they ever differ, the system says *do not certify this count*. Sealing a ballot and marking the roster happen in one database transaction, so a crash cannot create a gap.

---

## How secrecy and verifiability coexist

These usually pull against each other. The split:

- **`voters`** records *that* you voted — `has_voted`, `voted_at`. Nothing about your choices.
- **`ballots`** records *what* was voted — a random serial, the choices, a receipt hash. No voter column, no foreign key, no timestamp precise enough to correlate by. Nothing joins the two tables, so there is no query that reveals how any named student voted, even for someone with full database access.
- Your session token is deleted the moment your ballot is sealed.

Verification runs on the receipt instead. When you seal, you get a receipt code — a hash of your ballot's contents and serial. Paste it into the public receipt checker and you learn whether your ballot is still in the count. Because the receipt cannot be reversed into a set of choices, it is safe to show anyone: it cannot be used to prove how you voted, which is what makes vote-buying and pressure from an older student or a teacher fail.

### The audit log

Every meaningful event — login accepted, login rejected, ballot sealed, voting opened or closed, results published — is appended to `audit_log`. Each entry's hash is computed over the previous entry's hash:

```
entry_hash = sha256(prev_hash | timestamp | event | detail)
```

Delete an entry, edit a timestamp, or insert a row and every later hash stops matching. The committee dashboard recomputes the whole chain on load and names the first broken entry. Ballot-sealed entries record the serial and receipt only, never a student number.

---

## Threat model

| Attack | What stops it |
|---|---|
| Voting twice | `UPDATE ... WHERE has_voted = 0` inside a transaction. The second attempt changes zero rows and the ballot is rejected. Race conditions included. |
| Voting as someone else | Roster plus a one-time access code handed out in person. The weak link is code distribution — see *Before a real election*. |
| Overvoting or ranking a fake candidate | Every rule is re-checked server-side in `validateChoices`. The browser is treated as hostile. |
| Committee quietly deleting ballots they dislike | Ballots vanish from the receipt checker, the roster stops reconciling, and the hash chain breaks. Three independent alarms. |
| Committee peeking at results mid-vote to campaign | Results are gated behind a publish flag, and publishing is logged. |
| Finding out how a named student voted | No join exists between roster and ballots. |
| Vote-buying using the receipt as proof | The receipt hides the choices. It proves inclusion, not content. |

---

## Architecture

```
web/                  no framework, no build step, no CDN — opens offline
  index.html
  app.js              views, ballot state, API calls
  styles.css          design tokens and layout
server/
  index.js            HTTP routing, auth, ballot sealing, static files
  db.js               schema, hashing, hash-chained audit log
  tally.js            instant runoff + approval counting (pure functions)
  seed.js             roster, posts, candidates
  demo.js             casts random ballots for demos
data/election.db      SQLite, created on first run
```

Deliberately zero dependencies: Node 22's built-in `node:sqlite` and `node:http` do everything needed. Nothing to `npm install`, nothing that rots, and a panel can read the whole backend in one sitting.

### API

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/login` | anyone | Exchange student number + access code for a session |
| GET | `/api/status` | public | Open/closed, turnout |
| GET | `/api/ballot` | voter | Posts, candidates, rules |
| POST | `/api/vote` | voter | Validate, seal, return receipt |
| POST | `/api/verify` | public | Is this receipt in the count? |
| GET | `/api/receipts` | public | Full receipt list for independent checking |
| GET | `/api/results` | public once published | Full count with every runoff round |
| POST | `/api/admin/election` | committee | Open, close, publish |
| GET | `/api/admin/audit` | committee | Chain verification, recent entries, reconciliation |

---

## The interface

The design treats the screen as the paper ballot it replaces, because that is the object students and advisers already trust.

- **Palette** — bond-paper green-white (`#f2f4f1`), ballot ink (`#17211b`), pine for anything confirmed or counted (`#2f5d50`), gold for the marks the voter makes (`#e8b33a`), and one vermilion (`#b3371f`) reserved for a single irreversible act: sealing.
- **The oval** — tapping a candidate shades a circle, the way you shade an oval on a printed ballot. On ranked posts the rank number appears inside it; on approval posts it fills solid.
- **The stub** — the masthead carries a detachable stub along a perforation. Before you vote it holds your progress; after you seal, it tears off (the only animation in the app) and carries your serial and receipt. One moment of motion, marking the one moment that cannot be undone.
- **Results** — runoff rounds are drawn as stacked bars with the majority threshold as a vermilion line across the track, eliminated candidates struck through, and a plain sentence saying where their ballots went. Approval results draw a dashed cut after the last seat. The structure carries the explanation; students see *why* someone won, not just that they did.
- Everything is keyboard-reachable with visible focus, works down to a phone, and respects `prefers-reduced-motion`.

---

## Before a real election

This is a solid prototype, not something to run a live election on tomorrow. What it needs first:

1. **Serve over HTTPS.** Session tokens over plain HTTP are readable on school wifi.
2. **Hash the access codes.** They currently sit in the database in plain text. Store `sha256(code + per-voter salt)` and issue codes on printed slips signed for by each student.
3. **Rate-limit `/api/login`.** Six-character codes are guessable at speed. Lock a student number after five failures and make the committee unlock it in person.
4. **Publish the receipt list at close.** Export `/api/receipts` and post it, so students verify against a frozen list rather than a live server.
5. **Back up `data/election.db`** to a second machine during voting. WAL mode helps, but a dead laptop should not end the election.
6. **Write the rules down before voting opens** — the counting method, the tie-break, what counts as an abstention — and have the adviser and every party sign them. A published rule the loser agreed to in advance is worth more than any amount of code.
7. **Do a parallel manual count** on the first election. Export the ballots, count a couple of posts by hand, confirm the numbers match. That one exercise is what converts a system from "the app said so" into something people believe.

## Ideas worth adding

- Import the roster from the registrar's CSV instead of the seed script.
- A live turnout board by year level, projected in the lobby, to push participation.
- Candidate profile pages with platform text and a Q&A thread, closed the day before voting.
- Export the sealed ballots as CSV so anyone can re-run `tally.js` independently.
- Single transferable vote for the representative seats, once students are comfortable with ranking.
