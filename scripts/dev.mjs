#!/usr/bin/env node
/**
 * Start the whole project with one command:  npm run dev
 *
 * A live system needs two processes:
 *
 *   1. the election server (server/index.js) -- the roster, the ballot box and
 *      the audit chain, all in SQLite;
 *   2. the Vite dev server (client/) -- serves the React interface and proxies
 *      /api through to the election server.
 *
 * Starting them by hand has two traps this script exists to remove:
 *
 *   - Some shells export PORT=0. The server reads process.env.PORT before
 *     falling back to 4000, so a bare `node index.js` binds to a random port
 *     while the client's proxy still points at 4000. The interface then reports
 *     "no election server answered" and every visitor quietly votes inside
 *     their own browser instead. This script always passes a real port, and
 *     hands the same port to the proxy.
 *
 *   - Starting only the client looks like a working system until the gold
 *     offline band catches your eye, so both halves are started together.
 *
 * It also seeds the database when it is missing, and waits for the API to
 * answer before starting the client, so the first page load is already live
 * rather than booting into the offline engine.
 *
 * No dependencies: node:child_process, node:fs and node:net only.
 *
 * Options:
 *   --port <n>         election server port        (default 4000)
 *   --client-port <n>  interface port              (default 5173)
 *   --no-seed          never create/seed the database
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const serverDir = join(root, 'server')
const clientDir = join(root, 'client')
const viteBin = join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js')
const databaseFile = join(root, 'data', 'election.db')

/* ------------------------------------------------------------------ options */

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const apiPort = Number(option('port', '4000'))
const clientPort = Number(option('client-port', '5173'))
const seedIfMissing = !process.argv.includes('--no-seed')

for (const [name, value] of [['--port', apiPort], ['--client-port', clientPort]]) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`${name} needs a port number, got: ${option(name, '(nothing)')}`)
    process.exit(1)
  }
}

/* ------------------------------------------------------------------- helpers */

/**
 * Is something already accepting connections on this port?
 *
 * Both loopback families are probed, and that is not paranoia: the election
 * server binds 0.0.0.0 (IPv4) while Vite binds only [::1] (IPv6). Checking a
 * single family reports "nothing running" for one of them, and the launcher
 * then starts a second copy that dies on the busy port.
 */
function isListeningOn(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const settle = (answer) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(500)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

async function isListening(port) {
  const [v4, v6] = await Promise.all([
    isListeningOn('127.0.0.1', port),
    isListeningOn('::1', port)
  ])
  return v4 || v6
}

/** Returns true once the port answers, false if it never does. */
async function waitForPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isListening(port)) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

/** Run something to completion, inheriting the terminal (used for seeding). */
function runOnce(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`seed.js exited with code ${code}`))
    )
  })
}

const children = []
let shuttingDown = false

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill()
  process.exit(0)
}

/** Start a long-running child and prefix its output so the two stay readable. */
function start(label, args, options) {
  const child = spawn(process.execPath, args, options)
  children.push(child)

  const prefix = `[${label}] `
  for (const stream of [child.stdout, child.stderr]) {
    let pending = ''
    stream.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`)
    })
  }

  child.on('exit', (code) => {
    if (shuttingDown) return
    console.error(`\n${prefix}stopped (code ${code}). Shutting the other one down too.`)
    shutdown()
  })

  return child
}

/* ---------------------------------------------------------------------- main */

if (!existsSync(viteBin)) {
  console.error('client/node_modules is missing. Install it first:\n\n  cd client && npm install\n')
  process.exit(1)
}

if (!existsSync(databaseFile) && seedIfMissing) {
  console.log('No database yet -- seeding the roster, posts and candidates first.\n')
  await runOnce(['seed.js'], serverDir)
}

const apiAlreadyUp = await isListening(apiPort)
const clientAlreadyUp = await isListening(clientPort)

if (apiAlreadyUp) console.log(`Reusing the election server already listening on :${apiPort}.`)
if (clientAlreadyUp) console.log(`Reusing the interface already listening on :${clientPort}.`)

const started = []

if (!apiAlreadyUp) {
  start('server', ['index.js'], {
    cwd: serverDir,
    // The whole point of this script: a real port, never the shell's PORT=0.
    env: { ...process.env, PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  started.push('server')

  const up = await waitForPort(apiPort)
  if (!up) {
    console.error(`The election server never answered on :${apiPort}.`)
    shutdown()
  }
}

if (!clientAlreadyUp) {
  start('client', [viteBin, '--port', String(clientPort), '--strictPort'], {
    cwd: clientDir,
    // Read by vite.config.ts so the proxy follows --port.
    env: { ...process.env, SSG_API_PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  started.push('client')
}

if (started.length === 0) {
  console.log('\nEverything was already running. Nothing to start.')
  process.exit(0)
}

console.log(`
------------------------------------------------------------------
  Election server  : http://localhost:${apiPort}   (API + original site)
  Interface        : http://localhost:${clientPort}   (React client)
  Database         : data/election.db

  Voter            : 2026-1000 / DEMO01      (also 2026-1001 / DEMO02)
  Committee        : COMELEC-01 / ADMIN01
  Panel entry code : SSG-2026

  The interface should report "Connected to the election server".
  If it shows a gold "Offline demo engine" band, the API failed to
  answer and every ballot is being kept in the browser instead.
  Ctrl+C stops both processes.
------------------------------------------------------------------
`)

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
