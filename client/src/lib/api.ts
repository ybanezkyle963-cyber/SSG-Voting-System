/**
 * API layer.
 *
 * One entry point per route the server exposes. Every call first tries the real
 * election server on the same origin (Vite proxies `/api` to :4000 in dev). If
 * nothing answers, the request is served by the offline engine in `lib/offline.ts`
 * so the interface stays fully usable.
 *
 * Both paths return identical shapes and identical errors, so pages never need
 * to know which one served them.
 */

import { offlineRequest } from './offline'
import type {
  ApiMode,
  AuditReport,
  Ballot,
  Choices,
  ElectionState,
  Position,
  Receipt,
  ReceiptLookup,
  ResultsReport,
  Role,
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

export interface RawReceipt {
  receipt: string
  sealed_at: string
}

/* ------------------------------------------------------------ mode detection */

let mode: ApiMode | null = null
let detecting: Promise<ApiMode> | null = null

async function probeServer(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch('/api/status', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store'
    })
    if (!res.ok) return false
    const body = (await res.json()) as { turnout?: unknown }
    return typeof body?.turnout === 'object'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function detectMode(): Promise<ApiMode> {
  if (mode) return mode
  if (!detecting) {
    detecting = probeServer().then((live) => {
      mode = live ? 'live' : 'offline'
      detecting = null
      return mode
    })
  }
  return detecting
}

export function currentMode(): ApiMode {
  return mode ?? 'offline'
}

/* ----------------------------------------------------------------- transport */

interface CallOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  token?: string | null
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const token = options.token ?? null
  const activeMode = await detectMode()

  if (activeMode === 'offline') {
    const res = await offlineRequest({
      method,
      path,
      token,
      body: options.body ?? {}
    })
    if (res.status >= 400) {
      const message =
        res.body && typeof res.body === 'object' && 'error' in res.body
          ? String((res.body as { error: unknown }).error)
          : 'Request failed.'
      throw new ApiError(message, res.status)
    }
    return res.body as T
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (options.body) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
  } catch {
    // The server went away mid-session. Fall back rather than dead-end.
    mode = 'offline'
    return call<T>(path, options)
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

/* ------------------------------------------------------------------- endpoints */

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

  audit: (token: string) => call<AuditReport>('/api/admin/audit', { token }),

  /** The entry code gate. Returns false when the server has no such route. */
  unlock: async (code: string): Promise<'ok' | 'denied' | 'unsupported'> => {
    const activeMode = await detectMode()
    if (activeMode === 'offline') {
      try {
        await call<{ ok: boolean }>('/api/admin/gate', { method: 'POST', body: { code } })
        return 'ok'
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) return 'denied'
        throw err
      }
    }
    try {
      const res = await fetch('/api/admin/gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code })
      })
      if (res.status === 404) return 'unsupported'
      if (res.ok) return 'ok'
      if (res.status === 403 || res.status === 401) return 'denied'
      return 'unsupported'
    } catch {
      return 'unsupported'
    }
  },

  rotateCode: (token: string, code: string) =>
    call<{ ok: boolean }>('/api/admin/code', { method: 'POST', body: { code }, token }),

  resetDemoData: (token: string) =>
    call<{ ok: boolean }>('/api/admin/reset', { method: 'POST', token })
}

export type { Choices, Position, Role }
