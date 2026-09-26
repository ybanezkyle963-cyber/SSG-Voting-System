import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api } from '../lib/api'
import type { ElectionState, Session, Status, Turnout } from '../lib/types'

const SESSION_KEY = 'ssg-session-v1'

interface AuthValue {
  ready: boolean
  session: Session | null
  status: Status | null
  signIn: (studentNo: string, accessCode: string) => Promise<Session>
  signOut: () => void
  /** Records locally that this session's ballot has been sealed. */
  markVoted: () => void
  refreshStatus: () => Promise<void>
  setElection: (patch: { open?: boolean; publishResults?: boolean }) => Promise<ElectionState>
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
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      const stored = readSession()
      if (stored) {
        const valid = await validate(stored)
        if (cancelled) return
        if (valid) setSession(valid)
        else writeSession(null)
      }

      try {
        const next = await api.status()
        if (!cancelled) setStatus(next)
      } catch {
        /* the status widget simply stays empty until the server answers */
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
    setSession(null)
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

  const value = useMemo<AuthValue>(
    () => ({ ready, session, status, signIn, signOut, markVoted, refreshStatus, setElection }),
    [ready, session, status, signIn, signOut, markVoted, refreshStatus, setElection]
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
