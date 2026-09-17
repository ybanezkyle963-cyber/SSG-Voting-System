/** Types mirror the shapes returned by the election server (`server/index.js`). */

export type Role = 'voter' | 'committee'
export type Method = 'irv' | 'approval'

export interface Candidate {
  id: string
  name: string
  party: string
  yearLevel: string
  platform: string
}

export interface Position {
  id: string
  title: string
  seats: number
  method: Method
  candidates: Candidate[]
}

export interface Session {
  token: string
  role: Role
  name: string
  yearLevel: string
  hasVoted: boolean
  /**
   * What the student typed at sign-in. The server does not echo it back, but the
   * browser needs it to key this device's saved stub without ever storing a
   * ballot against a name.
   */
  studentNo?: string
}

export interface Turnout {
  registered: number
  voted: number
  sealed: number
  percent: number
  reconciled: boolean
}

export interface Status {
  open: boolean
  resultsPublished: boolean
  turnout: Turnout
}

export interface Ballot {
  positions: Position[]
  open: boolean
  hasVoted: boolean
}

export interface Receipt {
  serial: string
  receipt: string
  sealedAt: string
}

export interface ReceiptLookup {
  found: boolean
  serial?: string
  sealed_at?: string
}

export interface Named {
  id: string
  name: string
  party: string
}

export interface StandingRow {
  candidateId: string
  votes: number
  share: number
  name?: string
  party?: string
}

export interface Round {
  round: number
  active: number
  exhausted: number
  majorityNeeded: number
  counts: StandingRow[]
  eliminated: (Named | null)[] | null
}

export interface TallyOutcome {
  method: Method
  winners: Named[]
  tie: Named[] | null
  rounds?: Round[]
  standing?: StandingRow[]
  seats?: number
}

export interface PositionResult {
  positionId: string
  title: string
  seats: number
  method: Method
  abstentions: number
  ballotsCast: number
  winners: Named[]
  tie: Named[] | null
  rounds: Round[] | null
  standing: StandingRow[] | null
}

export interface ChainState {
  ok: boolean
  entries?: number
  head?: string
  brokenAt?: number
}

export interface AuditEntry {
  seq: number
  at: string
  event: string
  detail: string
  prev_hash: string
  entry_hash: string
}

export interface AuditReport {
  chain: ChainState
  entries: AuditEntry[]
  turnout: Turnout
}

export interface ResultsReport {
  turnout: Turnout
  chain: ChainState
  results: PositionResult[]
}

export interface ElectionState {
  open: boolean
  resultsPublished: boolean
}

/** A ballot is a map of position id -> chosen candidate ids (order = rank). */
export type Choices = Record<string, string[]>

export type ApiMode = 'live' | 'offline'
