# SSG Election — front end

A React + Vite + Tailwind interface for the SSG election server in this repository.
It keeps the server's guarantees visible instead of hiding them: the roster and the
ballot box are shown as two numbers that must match, the audit log is displayed as a
hash chain that breaks in front of you, and every ballot ends with a receipt a voter
can check without revealing what they marked.

## Run it

```bash
cd client
npm install
npm run dev            # http://localhost:5173
```

In dev, Vite proxies `/api` to `http://localhost:4000`, so start the election server
first if you want live data:

```bash
cd server && node seed.js && node index.js
```

### It also runs with no server at all

If nothing answers on `/api/status` within 1.5 seconds, the app switches to an
**offline engine** — a faithful in-browser implementation of the server's route table
(`src/lib/offline.ts`) with the same seeded roster, the same counting rules, the same
refusals, and a real hash chain, persisted in `localStorage`. Every screen works. A
gold band across the top says which mode you are in, so nobody mistakes a demo for a
live election.

Sign in with the same credentials the server seeds:

| Role | Student number | Access code |
|---|---|---|
| Voter | `2026-1000` | `DEMO01` |
| Voter | `2026-1001` | `DEMO02` |
| Committee | `COMELEC-01` | `ADMIN01` |

The demo credential chips on the sign-in screen fill the form for you.

## Screens

| Route | Who | What it is |
|---|---|---|
| `#/` | anyone | Sign in, plus what the system does and does not guarantee |
| `#/ballot` | voter | Mark → review → seal, then the detachable stub with serial and receipt |
| `#/verify` | anyone | Check a receipt, and read the full published receipt list |
| `#/results` | public once published | Canvass report: every runoff round, the seat cut-off, abstentions |
| `#/control` | committee, behind a code | Turnout, reconciliation, audit chain, open/close, publish |

Hash routing is deliberate: the built site works from any static path, including a
folder opened directly from disk, with no server rewrite rules.

### The two gates

1. **Sign in** — roster plus one-time access code, issuing a session token. Same as
   the server.
2. **The entry code** — `/control` asks for a second code (`SSG-2026` in the offline
   demo), separate from the committee login. Opening, closing, publishing and reading
   the audit log are the irreversible acts; a code held by the chair alone keeps that
   authority from travelling with a shared committee account.

The gate is verified by `POST /api/admin/gate` when the server has that route. A
deployment without it falls back to a code compiled in at build time
(`VITE_CONTROL_CODE`), which is a client-side check and is labelled as such in the UI.
Move it server-side when you can.

## Layout

```
src/
  App.tsx                route table
  lib/
    types.ts             shapes returned by the server
    api.ts               one function per route; live server or offline engine
    offline.ts           the in-browser engine (routes, seeding, audit chain)
    tally.ts             instant runoff + approval, ported from server/tally.js
    router.tsx           ~60-line hash router
    format.ts            dates, hashes, plurals, clipboard
  state/
    AuthContext.tsx      session, status, mode detection, the control gate
    ToastContext.tsx     transient messages, anchored top-right
  components/
    Layout.tsx           masthead, perforated strip, nav, mode banner
    ui.tsx               Button, Field, Card, Alert, Tag, Stat, BarRow, Modal, …
  pages/                 SignIn, Ballot, Verify, Results, Control
```

No runtime dependencies beyond React. No router library, no icon package, no state
library — the whole interface is readable in one sitting, which is the same reason the
server has no dependencies.

## Checks

```bash
npm run lint           # oxlint: 0 errors
npx tsc -b             # type check
npm run build          # production build
```

The seven remaining lint warnings are the scaffold's own convention hints, not
defects: five `only-export-components` for context files that export their hook
alongside their provider, and two `set-state-in-effect` for pages that fetch on mount
and therefore touch state from an effect — the documented legitimate use of an effect.

## Design notes

- **Paper, not dashboard.** Bond-paper background, ballot ink, pine for anything
  confirmed, gold for the marks the voter makes, and one vermilion reserved for the
  single irreversible act: sealing.
- **The oval.** Tapping a candidate shades a circle, the way a printed ballot is
  marked. Ranked posts show the rank inside it; approval posts fill it.
- **The stub.** A perforated edge separates the ballot from a detachable stub holding
  serial, receipt and sealing time. It survives a reload, so a voter can still find it
  after closing the tab — the one object they keep.
- **Keyboard and phone first.** Every control is reachable by tab with a visible focus
  ring, layouts work down to a phone, and `prefers-reduced-motion` is respected
  (the tear-off animation is the only motion in the app).
