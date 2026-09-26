/**
 * API layer — live only.
 *
 * One entry point per route the election server exposes. There is no offline
 * engine: if the server does not answer, the call fails and the interface says
 * so. A single deployment serves both the interface and the API, so every call
 * is same-origin.
 */

import type {
  AuditReport,
  Ballot,
  Choices,
  ElectionState,
  Receipt,
  ReceiptLookup,
  ResultsReport,
  Session,
  Status
} from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface CallOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  token?: string | null
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.token) headers.authorization = `Bearer ${options.token}`
  if (options.body) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
  } catch {
    throw new ApiError('The election server is not reachable. Try again shortly.', 0)
  }

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${res.status}).`
    throw new ApiError(message, res.status)
  }
  return payload as T
}

export const api = {
  login: (studentNo: string, accessCode: string) =>
    call<Session>('/api/login', { method: 'POST', body: { studentNo, accessCode } }),

  status: () => call<Status>('/api/status'),

  ballot: (token: string) => call<Ballot>('/api/ballot', { token }),

  vote: (token: string, choices: Choices) =>
    call<Receipt>('/api/vote', { method: 'POST', body: { choices }, token }),

  receipts: () => call<{ receipts: RawReceipt[] }>('/api/receipts'),

  verify: (receipt: string) =>
    call<ReceiptLookup>('/api/verify', { method: 'POST', body: { receipt } }),

  results: (token?: string | null) => call<ResultsReport>('/api/results', { token }),

  setElection: (token: string, patch: { open?: boolean; publishResults?: boolean }) =>
    call<ElectionState>('/api/admin/election', { method: 'POST', body: patch, token }),

  audit: (token: string) => call<AuditReport>('/api/admin/audit', { token })
}

export interface RawReceipt {
  receipt: string
  sealed_at: string
}

export type { Choices }
