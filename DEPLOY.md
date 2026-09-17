# Deploying

Two separate things live in this repository, and they host very differently.

| Part | What it is | Where it can run |
|---|---|---|
| `client/` | React + Vite + Tailwind interface | Any static host, including Vercel |
| `server/` | Node HTTP + `node:sqlite` election engine | A VPS / Node host with a **writable, persistent disk** |

---

## ⚠️ Read this before deploying to Vercel

**Vercel cannot host the election server.** It cannot, because the server keeps the
roster and the sealed ballots in a local SQLite file (`data/election.db`) and needs
that file to survive between requests. Vercel's functions have an ephemeral,
effectively read-only filesystem, and `node:sqlite` is not available there.

So a Vercel deployment is **the interface, not the election**. What you get:

- Every screen works: sign-in, the ballot, sealing, the stub, receipt checks, results,
  the code-gated control panel, the audit log.
- It runs on the **offline engine** (`client/src/lib/offline.ts`), which implements the
  server's route table in the browser and saves to that visitor's `localStorage`.
- A gold band across the top says so, so nobody mistakes it for a live election.

What that means in practice, and why it matters:

- **Each visitor gets their own separate election.** Two people opening the same Vercel
  URL are not voting in the same election — their ballots land in their own browser.
  Turnout will read `1/180` on each of their machines.
- **Nothing is shared, nothing is backed up.** Clearing site data erases the ballots.
- It is a **preview, a demo, a design review, or a classroom walkthrough** of the
  interface. It is not a way to run an SSG election over the internet.

To run a real election you need the server (see *Hosting the server* below), or a
rewrite of the storage layer onto a hosted database, plus HTTPS and hashed access
codes — the checklist in the main `README.md` under *Before a real election*.

---

## 1. Push to GitHub

The repository is already initialised and committed locally. Create an empty repo on
GitHub (**no** README, **no** .gitignore, **no** licence — this repo already has them),
then push:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

If you prefer the GitHub CLI, `gh repo create` does both steps at once:

```bash
gh auth login
gh repo create <repo-name> --public --source=. --remote=origin --push
```

## 2. Deploy to Vercel

`vercel.json` is already configured: it builds `client/` and serves `client/dist`.
Nothing else to set up. Either connect the repo in the Vercel dashboard
(**Add New → Project → import the repo**), or deploy from this folder:

```bash
npx vercel          # preview deployment
npx vercel --prod   # production deployment
```

The first run asks you to log in and to confirm the project settings — accept the
detected ones; `vercel.json` already supplies the build command
(`npm run build`, which builds the client), the output directory (`client/dist`) and
framework detection (`null`, i.e. plain static).

### Why no SPA rewrite is needed

Most React apps need a catch-all rewrite to `index.html` because their routes are real
paths. This one uses **hash routes** (`#/ballot`, `#/results`), so every request is for
`/` and the static files resolve on their own. That is also why `client/dist` can be
opened straight from disk with no server at all.

---

## 3. Hosting the server (for a real election)

Any Node host with a persistent disk will do — a school PC, a VPS, Railway, Render,
Fly.io. It needs Node 22.5 or newer for `node:sqlite`, and no `npm install`:

```bash
cd server
node seed.js      # once: creates the database, roster, posts and candidates
node index.js     # serves the API and the site on http://localhost:4000
```

Then point the client at it. In development the Vite proxy in `client/vite.config.ts`
handles this; in a built deployment, serve `client/dist` from the same origin as the
API so the `/api/*` calls resolve, and put HTTPS in front of both.
