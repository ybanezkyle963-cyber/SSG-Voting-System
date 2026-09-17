# Step-by-step: GitHub, then Vercel

Follow the sections in order. Part A puts the code on GitHub. Part B deploys it.
Part C checks it actually works. Part D covers making changes later.

**Read the warning box below first** — it explains what a Vercel deployment of this
project is and is not, and it is the one thing people get wrong.

---

## ⚠️ What Vercel can and cannot host

Two different things live in this repository:

| Part | What it is | Where it can run |
|---|---|---|
| `client/` | React + Vite + Tailwind interface | Any static host, including Vercel ✅ |
| `server/` | Node HTTP + `node:sqlite` election engine | A Node host with a **writable, persistent disk** ❌ not Vercel |

The server keeps the roster and the sealed ballots in a local SQLite file
(`data/election.db`) and needs that file to survive between requests. Vercel's
functions have an ephemeral filesystem, so the server cannot run there.

**So a Vercel deployment is the interface, not the election.** The client detects that
no server answers and runs on its in-browser engine (`client/src/lib/offline.ts`),
which implements the server's whole route table and saves to that visitor's
`localStorage`. A gold band across the top of every page says so.

What that means:

- **Each visitor gets their own separate election.** Two people opening the same Vercel
  URL do not share a ballot box — each sees `1/180` turnout on their own machine.
- **Nothing is shared and nothing is backed up.** Clearing site data erases the ballots.
- It is a **preview, demo, design review or classroom walkthrough** of the interface.
  It is not a way to run an SSG election over the internet.

For a real election, see *Part E: hosting the server properly*.

---

## Before you start

Already done in this checkout, so you can skip past it:

- Git repository initialised, everything committed on branch `main` (commit `bc936b4`).
- `gh` (GitHub CLI) 2.101.0 installed. Not logged in yet.
- Vercel CLI available through `npx`, already signed in as `ybanezkyle963-cyber`.
- Git Credential Manager is active, so `git push` will open a browser window to sign
  you in to GitHub. You never have to handle a token by hand.

You need: a GitHub account, and the project folder open in a terminal.

---

## Part A — put the code on GitHub

Pick **one** of the two routes. Route A1 needs no extra tools.

### Route A1 — through the browser (simplest)

**A1.1** Go to <https://github.com/new>.

**A1.2** Fill in:
- **Repository name:** `SSG-Voting-System`
- **Description:** optional
- **Public** — select this (you chose public)
- **Do NOT** tick "Add a README file", "Add .gitignore" or "Choose a license".
  This project already has all three, and adding them creates a conflicting commit.

**A1.3** Click **Create repository**.

**A1.4** On the page that appears ("…or push an existing repository from the command
line"), click the copy icon next to the HTTPS URL. It looks like
`https://github.com/ybanezkyle963-cyber/SSG-Voting-System.git`.

**A1.5** In a terminal, from the project folder, run these two commands — replacing the
URL with the one you copied:

```bash
git remote add origin https://github.com/ybanezkyle963-cyber/SSG-Voting-System.git
git push -u origin main
```

**A1.6** A window pops up asking you to sign in to GitHub (this is Git Credential
Manager). Choose **Sign in with your browser**, authorise it, and the push finishes.
Refresh your GitHub page — the files are there.

> If line 1 says `error: remote origin already exists`, run
> `git remote set-url origin <the URL>` instead, then push again.

### Route A2 — with the GitHub CLI (one command after login)

**A2.1** Start the login:

```bash
gh auth login --hostname github.com --git-protocol https --web
```

**A2.2** It prints a **one-time code** and opens <https://github.com/login/device>.
Paste the code, click **Authorize github**. When the terminal says
`Logged in as …`, you are done.

**A2.3** Create the repository, set it as `origin`, and push — all in one command:

```bash
gh repo create SSG-Voting-System --public --source=. --remote=origin --push
```

---

## Part B — deploy to Vercel

Again, pick one route. `vercel.json` in the project root already contains everything
Vercel needs (build `client/`, output `client/dist`), so neither route requires you to
change a single setting.

### Route B1 — connect the GitHub repo (recommended)

Use this one if you want Vercel to redeploy automatically every time you push.

**B1.1** Go to <https://vercel.com/new>.

**B1.2** Under **Import Git Repository**, find `SSG-Voting-System` and click
**Import**. If it is not listed, click **Adjust GitHub App Permissions** (or
**Add GitHub Account**), grant Vercel access to the repository, and come back.

**B1.3** On the configuration screen, leave everything as it is. `vercel.json` supplies
the framework preset, build command and output directory. Just click **Deploy**.

**B1.4** Wait about a minute. When it finishes you get a URL like
`https://ssg-voting-system.vercel.app`.

### Route B2 — from the terminal (no GitHub needed)

Works even if you skipped Part A entirely.

**B2.1** In a terminal, from the project folder:

```bash
npx vercel --prod --yes
```

**B2.2** The first run asks you to log in (the browser opens; authorise it) and to
confirm the project setup. `--yes` accepts the defaults from `vercel.json`. It prints
the production URL at the end.

---

## Part C — check the deployment

**C1.** Open your Vercel URL.

**C2.** You will see a **gold band saying "Offline demo engine."** This is expected and
correct — it means no election server answered, exactly as described in the warning at
the top of this file. It is not an error.

**C3.** Click the **Voter** demo chip, then **Sign in**. You land on the ballot.

**C4.** Mark a few posts — tap candidates on the ranked posts (a number appears in the
oval), and mark up to 4 on the Year Level Representatives post.

**C5.** Click **Review and seal** → **Seal my ballot** → **Yes, seal it**. You get a stub
with a serial number and a receipt code.

**C6.** Click **Check it in the count** and paste the receipt code. It should report
that your ballot is in the count.

**C7.** Click **Sign out**, then sign in as the committee: `COMELEC-01` / `ADMIN01`.

**C8.** It asks for a second code — the gate. Enter **`SSG-2026`**.

**C9.** You are in the control panel: turnout, the roster-versus-ballot reconciliation,
the audit log with its hash chain, and the open/close/publish controls. On the
**Audit log** tab, **Simulate tampering** edits a mid-log entry so you can watch the
chain break and name the first bad row.

---

## Part D — changing things later

**D1.** Edit the code, then:

```bash
git add -A
git commit -m "what changed and why"
git push
```

**D2.** Deploying the change:
- If you used **Route B1**, Vercel redeploys by itself within a minute.
- If you used **Route B2**, run `npx vercel --prod --yes` again.

**D3.** To work on it locally at any time:

```bash
npm run dev        # from the project root, or: cd client && npm run dev
```

Then open <http://localhost:5173>. Without a server running you get the offline engine,
same as on Vercel. With the server running on port 4000, the client uses it instead and
the gold band disappears.

---

## Part E — hosting the server properly

For a real election, the server needs a Node host with a persistent disk — a school PC,
a VPS, Railway, Render or Fly.io. It needs Node 22.5 or newer and no `npm install`:

```bash
cd server
node seed.js      # once: creates the database, roster, posts and candidates
node index.js     # serves the API and the site on http://localhost:4000
```

Quick check that it is up:

```bash
curl -s http://localhost:4000/api/status
# {"open":true,"resultsPublished":false,"turnout":{...}}
```

> **If the server seems to vanish**, check `echo $PORT`. The server reads
> `process.env.PORT` first and only falls back to 4000, so an environment that sets
> `PORT` to something unexpected will bind there instead. Passing it explicitly always
> works: `PORT=4000 node index.js`.

The original `web/` interface is served from the same origin, so opening
<http://localhost:4000> gives you the plain interface straight from the server. To use
the richer `client/` interface against this server, run its dev server — the proxy in
`client/vite.config.ts` forwards `/api` to port 4000 — or serve `client/dist` from the
same origin as the API in production. Put HTTPS in front of both. Before running anything real, work through the
*Before a real election* checklist in `README.md` — HTTPS, hashed access codes, login
rate limiting, a published receipt list, and a backup of the database.
