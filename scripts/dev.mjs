#!/usr/bin/env node
/**
 * Start the whole project with one command:  npm run dev
 *
 *   1. the NestJS election API (api/) -- listens on :4000 (or --port) and
 *      talks to the Vercel Postgres database, using the credentials in
 *      .env.local (vercel env pull). Schema and seed run automatically on
 *      boot if the database is empty.
 *   2. the Vite dev server (client/) -- serves the React interface on :5173
 *      and proxies /api to the API.
 *
 * NOTE: local development shares the one production database. Treat the data
 * accordingly; there is no separate offline mode any more.
 *
 * No dependencies beyond Node itself.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const apiDir = join(root, 'api')
const clientDir = join(root, 'client')
const apiEntry = join(apiDir, 'dist', 'index.js')
const tscBin = join(apiDir, 'node_modules', 'typescript', 'bin', 'tsc')
const viteBin = join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js')
const envFile = join(root, '.env.local')

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const apiPort = Number(option('port', '4000'))
const clientPort = Number(option('client-port', '5173'))

/* Load the Vercel-pulled environment (contains the Postgres credentials). */
const env = { ...process.env }
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

if (!existsSync(viteBin)) {
  console.error('client/node_modules is missing. Install it first:\n\n  cd client && npm install\n')
  process.exit(1)
}

const children = []
let shuttingDown = false

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill()
  process.exit(0)
}

function start(label, command, args, options) {
  const child = spawn(command, args, options)
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

async function isListening(port) {
  const { createConnection } = await import('node:net')
  for (const host of ['127.0.0.1', '::1']) {
    const ok = await new Promise((resolve) => {
      const socket = createConnection({ port, host })
      const settle = (a) => {
        socket.destroy()
        resolve(a)
      }
      socket.setTimeout(500)
      socket.once('connect', () => settle(true))
      socket.once('timeout', () => settle(false))
      socket.once('error', () => settle(false))
    })
    if (ok) return true
  }
  return false
}

/* Build the API if it has never been built. */
if (!existsSync(apiEntry)) {
  console.log('Building the API once (api/dist)...')
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tscBin, '-p', join(apiDir, 'tsconfig.json')], {
      stdio: 'inherit'
    })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('tsc failed'))))
    child.on('error', reject)
  })
}

if (await isListening(apiPort)) {
  console.log(`Reusing the API already listening on :${apiPort}.`)
} else {
  start('api', process.execPath, [apiEntry], {
    cwd: apiDir,
    env: { ...env, PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

if (await isListening(clientPort)) {
  console.log(`Reusing the interface already listening on :${clientPort}.`)
} else {
  start('client', process.execPath, [viteBin, '--port', String(clientPort), '--strictPort'], {
    cwd: clientDir,
    env: { ...env, SSG_API_PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

console.log(`
------------------------------------------------------------------
  Interface   : http://localhost:${clientPort}   (React client)
  API         : http://localhost:${apiPort}   (NestJS, Postgres)

  Committee   : admin / admin
  Voters      : seeded roster, random access codes (first boot seeds them)

  Both halves share the one database. Ctrl+C stops both.
------------------------------------------------------------------
`)

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
