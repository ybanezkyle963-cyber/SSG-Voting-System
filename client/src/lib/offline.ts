/**
 * Offline engine.
 *
 * A faithful, in-browser implementation of the election server's route table
 * (`server/index.js`) so the interface is fully usable — and demoable — without
 * a backend running. Responses have the same shapes, the same status codes and
 * the same refusal behaviour as the real server, including:
 *
 *   - roster and ballot box counted separately, sealed in one "transaction"
 *   - double voting refused
 *   - a hash-chained audit log that breaks visibly if edited
 *   - results withheld until the publish flag is set
 *
 * When a real server answers on the same origin, `lib/api.ts` prefers it and
 * this engine is never used. Nothing here is a security boundary: it runs in the
 * browser, so treat it as a demo. The real rules live on the server.
 */

import type {
  AuditReport,
  Ballot,
  ChainState,
  Choices,
  ElectionState,
  PositionResult,
  Receipt,
  ReceiptLookup,
  ResultsReport,
  Role,
  Session,
  Status,
  Turnout
} from './types'
import { approval, instantRunoff } from './tally'

const STORAGE_KEY = 'ssg-election-offline-v1'
const SESSION_HOURS = 2
export const DEFAULT_CONTROL_CODE = 'SSG-2026'

/* --------------------------------------------------------------------- codec */

const encoder = new TextEncoder()

/** SHA-256, matching the server's hash. Falls back if SubtleCrypto is absent. */
export async function sha256(input: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(input))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Non-secure context (plain http on a LAN IP). Deterministic, not cryptographic —
  // the verification flow still works, it just is not a real digest.
  let h1 = 0x811c9dc5
  let h2 = 0xc2b2ae35
  for (let i = 0; i < input.length; i++) {
    h1 = (h1 ^ input.charCodeAt(i)) * 0x01000193
    h2 = (h2 + input.charCodeAt(i) * (i + 1)) >>> 0
  }
  const block = (seed: number) => {
    let out = ''
    let x = seed >>> 0
    for (let i = 0; i < 16; i++) {
      x = (x * 1664525 + 1013904223) >>> 0
      out += (x & 0xff).toString(16).padStart(2, '0')
    }
    return out
  }
  return block(h1 ^ h2).slice(0, 64)
}

function randomHex(n: number): string {
  const bytes = new Uint8Array(n)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* --------------------------------------------------------------------- state */

interface VoterRow {
  student_no: string
  full_name: string
  year_level: string
  access_code: string
  role: Role
  has_voted: number
  voted_at: string | null
}

interface SessionRow {
  token: string
  student_no: string
  role: Role
  created_at: string
  expires_at: string
}

interface PositionRow {
  id: string
  title: string
  seats: number
  method: 'irv' | 'approval'
  sort_order: number
}

interface CandidateRow {
  id: string
  position_id: string
  name: string
  party: string
  year_level: string
  platform: string
  sort_order: number
}

interface BallotRow {
  serial: string
  receipt: string
  choices_json: string
  sealed_at: string
}

interface AuditRow {
  seq: number
  at: string
  event: string
  detail: string
  prev_hash: string
  entry_hash: string
}

interface State {
  voters: VoterRow[]
  sessions: SessionRow[]
  positions: PositionRow[]
  candidates: CandidateRow[]
  ballots: BallotRow[]
  audit_log: AuditRow[]
  settings: {
    election_open: string
    results_published: string
    control_code: string
  }
  seq: number
}

/* ------------------------------------------------------------------- seeding */

const POSITIONS: PositionRow[] = [
  { id: 'president', title: 'President', seats: 1, method: 'irv', sort_order: 1 },
  { id: 'vice-president', title: 'Vice President', seats: 1, method: 'irv', sort_order: 2 },
  { id: 'secretary', title: 'Secretary', seats: 1, method: 'irv', sort_order: 3 },
  { id: 'treasurer', title: 'Treasurer', seats: 1, method: 'irv', sort_order: 4 },
  { id: 'auditor', title: 'Auditor', seats: 1, method: 'irv', sort_order: 5 },
  { id: 'pio', title: 'Public Information Officer', seats: 1, method: 'irv', sort_order: 6 },
  { id: 'representatives', title: 'Year Level Representatives', seats: 4, method: 'approval', sort_order: 7 }
]

const CANDIDATES: [string, string, string, string, string, string][] = [
  ['pres-1', 'president', 'Althea Marasigan', 'Buklod', 'Grade 12', 'Publish the SSG budget every month and open the org fund to student questions.'],
  ['pres-2', 'president', 'Rafael Domingo', 'Sulong', 'Grade 12', 'A working student lounge and a review week free of major school events.'],
  ['pres-3', 'president', 'Nadine Ocampo', 'Independent', 'Grade 11', 'Bring back the inter-year sports league and fund four new club charters.'],
  ['vp-1', 'vice-president', 'Joaquin Reyes', 'Buklod', 'Grade 11', 'One officer on duty at the SSG desk during every lunch break.'],
  ['vp-2', 'vice-president', 'Bea Villanueva', 'Sulong', 'Grade 12', 'Run the committee system properly so projects stop dying in planning.'],
  ['sec-1', 'secretary', 'Miguel Santibañez', 'Sulong', 'Grade 11', 'Minutes posted within 48 hours of every meeting.'],
  ['sec-2', 'secretary', 'Kyla Ferrer', 'Buklod', 'Grade 10', 'A shared calendar so clubs stop booking the same dates.'],
  ['tre-1', 'treasurer', 'Danilo Aquino', 'Buklod', 'Grade 12', 'Itemised receipts for every event, posted on the SSG board.'],
  ['tre-2', 'treasurer', 'Patricia Lim', 'Independent', 'Grade 11', 'Cut event fees by moving printing and tarpaulins in-house.'],
  ['aud-1', 'auditor', 'Ysabel Cruz', 'Sulong', 'Grade 12', 'A published quarterly audit, not just an end-of-year summary.'],
  ['aud-2', 'auditor', 'Enrique Bautista', 'Buklod', 'Grade 11', 'Spot-check every disbursement above one thousand pesos.'],
  ['pio-1', 'pio', 'Trisha Mendoza', 'Buklod', 'Grade 10', 'Announcements in Filipino and English, posted the same day.'],
  ['pio-2', 'pio', 'Carlo Panganiban', 'Independent', 'Grade 12', 'A weekly two-minute recap so nobody misses deadlines.'],
  ['rep-1', 'representatives', 'Lourdes Katigbak', 'Buklod', 'Grade 12', 'Seniors need a clear graduation-fee schedule by August.'],
  ['rep-2', 'representatives', 'Emman Salvador', 'Sulong', 'Grade 12', 'Longer library hours during exam weeks.'],
  ['rep-3', 'representatives', 'Jasmine Ilagan', 'Independent', 'Grade 11', 'Repair the covered walkway before rainy season.'],
  ['rep-4', 'representatives', 'Noel Fajardo', 'Buklod', 'Grade 11', 'A canteen price board that is actually kept up to date.'],
  ['rep-5', 'representatives', 'Chesca Bituin', 'Sulong', 'Grade 10', 'Orientation buddies for every incoming section.'],
  ['rep-6', 'representatives', 'Arvin Gutierrez', 'Independent', 'Grade 10', 'Charging stations and working fans in every classroom.']
]

const SURNAMES = ['Alvarez', 'Bautista', 'Castillo', 'Dela Cruz', 'Espinosa', 'Fernandez', 'Garcia', 'Hernandez', 'Ignacio', 'Jimenez', 'Lorenzo', 'Mercado', 'Navarro', 'Ortega', 'Pascual', 'Quinto', 'Ramos', 'Silvestre', 'Torres', 'Uy', 'Valdez', 'Yap']
const GIVEN = ['Aiza', 'Bryan', 'Cielo', 'Dennis', 'Elaine', 'Francis', 'Grace', 'Hector', 'Ivy', 'Jonas', 'Karla', 'Leo', 'Mika', 'Nico', 'Olivia', 'Paulo', 'Queenie', 'Rico', 'Sam', 'Tina', 'Ulysses', 'Vien']
const LEVELS = ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12']

function blankState(): State {
  const voters: VoterRow[] = []
  for (let i = 0; i < 180; i++) {
    voters.push({
      student_no: `2026-${1000 + i}`,
      full_name: `${GIVEN[i % GIVEN.length]} ${SURNAMES[(i * 7) % SURNAMES.length]}`,
      year_level: LEVELS[i % LEVELS.length],
      access_code: randomHex(3).toUpperCase(),
      role: 'voter',
      has_voted: 0,
      voted_at: null
    })
  }
  const demo = voters.find((v) => v.student_no === '2026-1000')
  if (demo) demo.access_code = 'DEMO01'
  const demo2 = voters.find((v) => v.student_no === '2026-1001')
  if (demo2) demo2.access_code = 'DEMO02'
  voters.push({
    student_no: 'COMELEC-01',
    full_name: 'Election Committee',
    year_level: 'Faculty',
    access_code: 'ADMIN01',
    role: 'committee',
    has_voted: 0,
    voted_at: null
  })

  return {
    voters,
    sessions: [],
    positions: POSITIONS,
    candidates: CANDIDATES.map(([id, position_id, name, party, year_level, platform], i) => ({
      id,
      position_id,
      name,
      party,
      year_level,
      platform,
      sort_order: i + 1
    })),
    ballots: [],
    audit_log: [],
    settings: { election_open: '1', results_published: '0', control_code: DEFAULT_CONTROL_CODE },
    seq: 0
  }
}

let cache: State | null = null

function load(): State {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (parsed?.voters?.length && parsed?.positions?.length) {
        cache = parsed
        return cache
      }
    }
  } catch {
    /* corrupt or unavailable storage: fall through and reseed */
  }
  cache = blankState()
  void appendAudit(cache, 'election.seeded', {
    positions: POSITIONS.length,
    candidates: CANDIDATES.length,
    voters: 180
  })
  save()
  return cache
}

function save() {
  if (!cache) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    /* storage full or blocked: the session still works, it just will not persist */
  }
}

/**
 * Demo-only: edits a middle entry of the audit log in place, the way a committee
 * member with database access would. The chain must break visibly afterwards.
 */
export function tamperWithLog(): number | null {
  const state = load()
  const target = state.audit_log[Math.floor(state.audit_log.length / 2)]
  if (!target) return null
  target.detail = JSON.stringify({ quietly: 'edited' })
  save()
  return target.seq
}

export function resetEngine() {
  cache = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  load()
}

/* ---------------------------------------------------------------- audit chain */

async function appendAudit(state: State, event: string, detail: Record<string, unknown> = {}) {
  const prev = state.audit_log[state.audit_log.length - 1]
  const prevHash = prev ? prev.entry_hash : 'genesis'
  const at = new Date().toISOString()
  const body = JSON.stringify(detail)
  const entry_hash = await sha256(`${prevHash}|${at}|${event}|${body}`)
  state.seq += 1
  state.audit_log.push({ seq: state.seq, at, event, detail: body, prev_hash: prevHash, entry_hash })
  return entry_hash
}

async function verifyChain(state: State): Promise<ChainState> {
  let prevHash = 'genesis'
  for (const r of state.audit_log) {
    const expected = await sha256(`${prevHash}|${r.at}|${r.event}|${r.detail}`)
    if (r.prev_hash !== prevHash || r.entry_hash !== expected) return { ok: false, brokenAt: r.seq }
    prevHash = r.entry_hash
  }
  return { ok: true, entries: state.audit_log.length, head: prevHash }
}

/* ------------------------------------------------------------------- helpers */

function settings(state: State) {
  return state.settings
}

const isOpen = (state: State) => settings(state).election_open === '1'
const resultsPublished = (state: State) => settings(state).results_published === '1'

function currentUser(state: State, token: string | null): (SessionRow & VoterRow) | null {
  if (!token) return null
  const row = state.sessions.find((s) => s.token === token && s.expires_at > new Date().toISOString())
  if (!row) return null
  const voter = state.voters.find((v) => v.student_no === row.student_no)
  return voter ? { ...voter, ...row, has_voted: voter.has_voted } : null
}

function ballotPaper(state: State) {
  return state.positions
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({
      id: p.id,
      title: p.title,
      seats: p.seats,
      method: p.method,
      candidates: state.candidates
        .filter((c) => c.position_id === p.id)
        .map(({ id, name, party, year_level, platform }) => ({
          id,
          name,
          party,
          yearLevel: year_level,
          platform
        }))
    }))
}

function turnout(state: State): Turnout {
  const voters = state.voters.filter((v) => v.role === 'voter')
  const voted = voters.filter((v) => v.has_voted === 1).length
  const sealed = state.ballots.length
  return {
    registered: voters.length,
    voted,
    sealed,
    percent: voters.length ? +((voted / voters.length) * 100).toFixed(1) : 0,
    reconciled: voted === sealed
  }
}

/** Every rule re-checked here, exactly as the server does. */
function validateChoices(state: State, choices: Choices) {
  const clean: Choices = {}
  for (const post of ballotPaper(state)) {
    const picked = choices?.[post.id] ?? []
    if (!Array.isArray(picked)) return { error: `Malformed entry for ${post.title}.` }
    const valid = new Set(post.candidates.map((c) => c.id))
    if (picked.some((id) => !valid.has(id))) return { error: `Unknown candidate for ${post.title}.` }
    if (new Set(picked).size !== picked.length) return { error: `Repeated candidate for ${post.title}.` }
    if (post.method === 'approval' && picked.length > post.seats) {
      return { error: `${post.title} allows at most ${post.seats} choices.` }
    }
    clean[post.id] = picked
  }
  return { clean }
}

async function computeResults(state: State): Promise<ResultsReport> {
  const paper = ballotPaper(state)
  const ballots: Choices[] = state.ballots.map((b) => JSON.parse(b.choices_json) as Choices)
  const names = new Map(state.candidates.map((c) => [c.id, c]))
  const label = (id: string) => ({
    id,
    name: names.get(id)?.name ?? id,
    party: names.get(id)?.party ?? ''
  })

  const results: PositionResult[] = paper.map((post) => {
    const cast = ballots.map((b) => b[post.id] ?? [])
    const abstentions = cast.filter((c) => c.length === 0).length
    const ids = post.candidates.map((c) => c.id)
    const outcome =
      post.method === 'irv' ? instantRunoff(cast, ids) : approval(cast, ids, post.seats)

    const rounds =
      'rounds' in outcome
        ? outcome.rounds.map((r) => ({
            ...r,
            counts: r.counts.map((c) => ({ ...c, ...label(c.candidateId) })),
            eliminated: r.eliminated?.map(label) ?? null
          }))
        : null

    const standing =
      'standing' in outcome
        ? outcome.standing.map((c) => ({ ...c, ...label(c.candidateId) }))
        : null

    return {
      positionId: post.id,
      title: post.title,
      seats: post.seats,
      method: post.method,
      abstentions,
      ballotsCast: cast.length,
      winners: outcome.winners.map(label),
      tie: outcome.tie ? outcome.tie.map(label) : null,
      rounds,
      standing
    }
  })

  return { turnout: turnout(state), chain: await verifyChain(state), results }
}

/* -------------------------------------------------------------------- routes */

export interface EngineRequest {
  method: string
  path: string
  token: string | null
  body: Record<string, unknown>
}

export interface EngineResponse {
  status: number
  body: unknown
}

type Handler = (state: State, req: EngineRequest) => Promise<EngineResponse> | EngineResponse

const ok = <T>(body: T, status = 200): EngineResponse => ({ status, body })
const fail = (status: number, error: string): EngineResponse => ({ status, body: { error } })

const routes: Record<string, Handler> = {
  'POST /api/login': async (state, { body }) => {
    const studentNo = String(body.studentNo ?? '').trim()
    const accessCode = String(body.accessCode ?? '').trim()
    const voter = state.voters.find((v) => v.student_no === studentNo)

    if (!voter || voter.access_code !== accessCode) {
      await appendAudit(state, 'login.rejected', { studentNo })
      save()
      return fail(401, 'That student number and access code do not match our roster.')
    }

    const token = randomHex(24)
    const now = new Date()
    state.sessions = state.sessions.filter((s) => s.expires_at > now.toISOString())
    state.sessions.push({
      token,
      student_no: voter.student_no,
      role: voter.role,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString()
    })
    await appendAudit(state, 'login.accepted', { studentNo: voter.student_no, role: voter.role })
    save()

    const session: Session = {
      token,
      role: voter.role,
      name: voter.full_name,
      yearLevel: voter.year_level,
      hasVoted: voter.has_voted === 1
    }
    return ok(session)
  },

  'GET /api/status': (state) =>
    ok<Status>({
      open: isOpen(state),
      resultsPublished: resultsPublished(state),
      turnout: turnout(state)
    }),

  'GET /api/ballot': (state, { token }) => {
    const user = currentUser(state, token)
    if (!user) return fail(401, 'Sign in to view the ballot.')
    return ok<Ballot>({
      positions: ballotPaper(state),
      open: isOpen(state),
      hasVoted: user.has_voted === 1
    })
  },

  'POST /api/vote': async (state, { token, body }) => {
    const user = currentUser(state, token)
    if (!user || user.role !== 'voter') return fail(401, 'Sign in to vote.')
    if (!isOpen(state)) return fail(409, 'Voting is closed.')
    if (user.has_voted === 1) return fail(409, 'Our roster already records a ballot for you.')

    const { clean, error } = validateChoices(state, (body.choices ?? {}) as Choices)
    if (error || !clean) return fail(400, error ?? 'Ballot could not be read.')

    const serial = randomHex(6).toUpperCase()
    const sealedAt = new Date().toISOString()
    const payload = JSON.stringify(clean)
    const receipt = (await sha256(`${serial}|${payload}|${sealedAt}`)).slice(0, 32)

    const voter = state.voters.find((v) => v.student_no === user.student_no)
    // The roster claim and the ballot are written together, so a reload can never
    // produce a counted voter with no ballot — or the reverse.
    if (!voter || voter.has_voted === 1) {
      return fail(409, 'Our roster already records a ballot for you.')
    }
    voter.has_voted = 1
    voter.voted_at = sealedAt
    state.ballots.push({ serial, receipt, choices_json: payload, sealed_at: sealedAt })

    // The log records that a ballot was sealed. It never records by whom.
    await appendAudit(state, 'ballot.sealed', { serial, receipt })
    state.sessions = state.sessions.filter((s) => s.token !== token)
    save()

    const out: Receipt = { serial, receipt, sealedAt }
    return ok(out, 201)
  },

  'GET /api/receipts': (state) =>
    ok({
      receipts: state.ballots
        .slice()
        .sort((a, b) => a.sealed_at.localeCompare(b.sealed_at))
        .map((b) => ({ receipt: b.receipt, sealed_at: b.sealed_at }))
    }),

  'POST /api/verify': (state, { body }) => {
    const receipt = String(body.receipt ?? '').trim()
    const row = state.ballots.find((b) => b.receipt === receipt)
    const out: ReceiptLookup = row
      ? { found: true, serial: row.serial, sealed_at: row.sealed_at }
      : { found: false }
    return ok(out)
  },

  'GET /api/results': async (state, { token }) => {
    const user = currentUser(state, token)
    if (!resultsPublished(state) && user?.role !== 'committee') {
      return fail(403, 'Results are released once voting closes.')
    }
    return ok(await computeResults(state))
  },

  'POST /api/admin/election': async (state, { token, body }) => {
    const user = currentUser(state, token)
    if (user?.role !== 'committee') return fail(403, 'Committee sign-in required.')

    if (body.open !== undefined) {
      state.settings.election_open = body.open ? '1' : '0'
      await appendAudit(state, body.open ? 'election.opened' : 'election.closed', {
        by: user.student_no
      })
    }
    if (body.publishResults !== undefined) {
      state.settings.results_published = body.publishResults ? '1' : '0'
      await appendAudit(state, 'results.published', {
        by: user.student_no,
        published: !!body.publishResults
      })
    }
    save()
    const out: ElectionState = { open: isOpen(state), resultsPublished: resultsPublished(state) }
    return ok(out)
  },

  'GET /api/admin/audit': async (state, { token }) => {
    const user = currentUser(state, token)
    if (user?.role !== 'committee') return fail(403, 'Committee sign-in required.')
    const report: AuditReport = {
      chain: await verifyChain(state),
      entries: state.audit_log.slice(-100).reverse(),
      turnout: turnout(state)
    }
    return ok(report)
  },

  /* The second gate in front of the most dangerous screens. */
  'POST /api/admin/gate': async (state, { body }) => {
    const code = String(body.code ?? '').trim()
    if (!code || code !== settings(state).control_code) {
      await appendAudit(state, 'control.rejected', {})
      save()
      return fail(403, 'That entry code is not recognised.')
    }
    await appendAudit(state, 'control.unlocked', {})
    save()
    return ok({ ok: true })
  },

  'POST /api/admin/code': async (state, { token, body }) => {
    const user = currentUser(state, token)
    if (user?.role !== 'committee') return fail(403, 'Committee sign-in required.')
    const next = String(body.code ?? '').trim()
    if (next.length < 6) return fail(400, 'Use at least six characters for the entry code.')
    if (!/^[A-Za-z0-9-]+$/.test(next)) {
      return fail(400, 'Letters, numbers and dashes only.')
    }
    state.settings.control_code = next
    await appendAudit(state, 'control.code-changed', { by: user.student_no })
    save()
    return ok({ ok: true })
  },

  'POST /api/admin/reset': async (state, { token }) => {
    const user = currentUser(state, token)
    if (user?.role !== 'committee') return fail(403, 'Committee sign-in required.')
    resetEngine()
    return ok({ ok: true })
  }
}

/** Dispatches a call exactly as the server's route table would. */
export async function offlineRequest(req: EngineRequest): Promise<EngineResponse> {
  const state = load()
  const handler = routes[`${req.method} ${req.path}`]
  if (!handler) return fail(404, 'Not found.')
  try {
    return await handler(state, req)
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : 'Request could not be processed.')
  }
}

/** Offline-only helper: current control code, so the panel can show it in demo mode. */
export function offlineControlCode(): string {
  return settings(load()).control_code
}
