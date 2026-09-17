import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, currentMode, detectMode } from '../lib/api'
import { DEFAULT_CONTROL_CODE, resetEngine } from '../lib/offline'
import type { ApiMode, ElectionState, Session, Status, Turnout } from '../lib/types'

const SESSION_KEY = 'ssg-session-v1'
const GATE_KEY = 'ssg-control-unlocked'

export type GateResult = 'ok' | 'denied'

interface AuthValue {
  mode: ApiMode
  ready: boolean
  session: Session | null
  status: Status | null
  /** True once the entry code has been accepted for this browser session. */
  controlOpen: boolean
  signIn: (studentNo: string, accessCode: string) => Promise<Session>
  signOut: () => void
  /** Records locally that this session's ballot has been sealed. */
  markVoted: () => void
  refreshStatus: () => Promise<void>
  setElection: (patch: { open?: boolean; publishResults?: boolean }) => Promise<ElectionState>
  unlockControl: (code: string) => Promise<GateResult>
  lockControl: () => void
  signOutToOffline: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function writeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ApiMode>(currentMode)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [controlOpen, setControlOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      const detected = await detectMode()
      if (cancelled) return
      setMode(detected)

      const stored = readSession()
      if (stored) {
        const valid = await validate(stored)
        if (cancelled) return
        if (valid) {
          setSession(valid)
          if (valid.role === 'committee' && sessionStorage.getItem(GATE_KEY) === '1') {
            setControlOpen(true)
          }
        } else {
          writeSession(null)
        }
      }

      try {
        const next = await api.status()
        if (!cancelled) setStatus(next)
      } catch {
        /* the status widget simply stays empty */
      }
      if (!cancelled) setReady(true)
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status())
    } catch {
      /* ignore */
    }
  }, [])

  const signIn = useCallback(
    async (studentNo: string, accessCode: string) => {
      const issued = await api.login(studentNo, accessCode)
      const next: Session = { ...issued, studentNo: studentNo.trim() }
      writeSession(next)
      setSession(next)
      if (next.role !== 'committee') {
        sessionStorage.removeItem(GATE_KEY)
        setControlOpen(false)
      }
      await refreshStatus()
      return next
    },
    [refreshStatus]
  )

  const markVoted = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev
      const next = { ...prev, hasVoted: true }
      writeSession(next)
      return next
    })
  }, [])

  const signOut = useCallback(() => {
    writeSession(null)
    sessionStorage.removeItem(GATE_KEY)
    setSession(null)
    setControlOpen(false)
    void refreshStatus()
  }, [refreshStatus])

  const signOutToOffline = useCallback(() => {
    resetEngine()
    writeSession(null)
    sessionStorage.removeItem(GATE_KEY)
    setSession(null)
    setControlOpen(false)
    void refreshStatus()
  }, [refreshStatus])

  const setElection = useCallback(
    async (patch: { open?: boolean; publishResults?: boolean }) => {
      if (!session) throw new ApiError('Sign in first.', 401)
      const next = await api.setElection(session.token, patch)
      await refreshStatus()
      return next
    },
    [session, refreshStatus]
  )

  const unlockControl = useCallback(async (code: string): Promise<GateResult> => {
    const result = await api.unlock(code)

    // A deployment whose server has no gate route yet still gets the gate: it is
    // checked against the code compiled in at build time. Set VITE_CONTROL_CODE
    // for real use, and move the check server-side when you can.
    if (result === 'unsupported') {
      const expected = (import.meta.env.VITE_CONTROL_CODE as string | undefined) ?? DEFAULT_CONTROL_CODE
      if (code.trim() !== expected) return 'denied'
    } else if (result === 'denied') {
      return 'denied'
    }

    sessionStorage.setItem(GATE_KEY, '1')
    setControlOpen(true)
    return 'ok'
  }, [])

  const lockControl = useCallback(() => {
    sessionStorage.removeItem(GATE_KEY)
    setControlOpen(false)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      mode,
      ready,
      session,
      status,
      controlOpen,
      signIn,
      signOut,
      markVoted,
      refreshStatus,
      setElection,
      unlockControl,
      lockControl,
      signOutToOffline
    }),
    [
      mode,
      ready,
      session,
      status,
      controlOpen,
      signIn,
      signOut,
      markVoted,
      refreshStatus,
      setElection,
      unlockControl,
      lockControl,
      signOutToOffline
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Confirms a stored token is still good, and refreshes the roster flag. */
async function validate(session: Session): Promise<Session | null> {
  try {
    if (session.role === 'voter') {
      const ballot = await api.ballot(session.token)
      return { ...session, hasVoted: ballot.hasVoted }
    }
    await api.audit(session.token)
    return session
  } catch {
    return null
  }
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function turnoutSummary(turnout: Turnout | undefined): string {
  if (!turnout) return '—'
  return `${turnout.voted} of ${turnout.registered} (${turnout.percent}%)`
}
