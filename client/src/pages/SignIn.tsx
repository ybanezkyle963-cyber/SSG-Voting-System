import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, navigate } from '../lib/router'
import { useAuth } from '../state/AuthContext'
import { useToast } from '../state/ToastContext'
import { Alert, Button, Card, Field, Spinner, Tag } from '../components/ui'

const DEMO = [
  { label: 'Voter', studentNo: '2026-1000', accessCode: 'DEMO01' },
  { label: 'Voter 2', studentNo: '2026-1001', accessCode: 'DEMO02' },
  { label: 'Committee', studentNo: 'COMELEC-01', accessCode: 'ADMIN01' }
]

export function SignIn() {
  const { session, signIn, signOut, mode } = useAuth()
  const { notify } = useToast()
  const [studentNo, setStudentNo] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) {
    return (
      <div className="mx-auto max-w-xl">
        <Card
          eyebrow="Signed in"
          title={`Hello, ${session.name}.`}
          actions={
            <Button size="sm" onClick={signOut}>
              Sign out
            </Button>
          }
        >
          <p className="font-sans text-sm text-ink/80">
            You are signed in as{' '}
            <Tag tone={session.role === 'committee' ? 'seal' : 'pine'}>
              {session.role === 'committee' ? 'Election committee' : session.yearLevel}
            </Tag>
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {session.role === 'voter' ? (
              <Link to="/ballot">
                <Button variant="primary">
                  {session.hasVoted ? 'View your ballot stub' : 'Open the ballot'}
                </Button>
              </Link>
            ) : (
              <Link to="/control">
                <Button variant="seal">Election control</Button>
              </Link>
            )}
            <Link to="/results">
              <Button>Results</Button>
            </Link>
            <Link to="/verify">
              <Button>Check a receipt</Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const next = await signIn(studentNo.trim(), accessCode.trim())
      notify(`Signed in as ${next.name}.`, 'success')
      navigate(next.role === 'committee' ? '/control' : '/ballot')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div>
        <h1 className="text-3xl leading-tight sm:text-4xl">Cast your ballot</h1>
        <p className="mt-3 max-w-prose text-ink/80">
          Sign in with the student number and one-time access code issued to you in person. The
          roster records <em>that</em> you voted. Nothing anywhere records <em>how</em>.
        </p>

        <form onSubmit={submit} className="mt-6 max-w-md">
          <div className="card space-y-4 px-4 py-5 sm:px-5">
            <Field
              label="Student number"
              name="studentNo"
              autoComplete="username"
              autoCapitalize="characters"
              placeholder="2026-1000"
              value={studentNo}
              onChange={(e) => setStudentNo(e.target.value)}
              required
            />
            <Field
              label="Access code"
              name="accessCode"
              autoComplete="current-password"
              placeholder="DEMO01"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              required
            />

            {error ? <Alert tone="error">{error}</Alert> : null}

            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Signing in' : 'Sign in'}
              </Button>
              {busy ? <Spinner label="Checking roster" /> : null}
            </div>
          </div>
        </form>

        <div className="mt-6 max-w-md">
          <p className="label">Demo credentials</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO.map((d) => (
              <button
                key={d.studentNo}
                type="button"
                onClick={() => {
                  setStudentNo(d.studentNo)
                  setAccessCode(d.accessCode)
                  setError('')
                }}
                className="border border-rule bg-white/70 px-3 py-1.5 text-left font-sans text-xs hover:border-pine"
              >
                <span className="block font-semibold uppercase tracking-[0.12em] text-ink-60">
                  {d.label}
                </span>
                <span className="numeric text-ink">
                  {d.studentNo} · {d.accessCode}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 font-sans text-xs text-ink-60">
            One tap fills the form. Tap "Sign in" after.
          </p>
        </div>
      </div>

      <aside className="space-y-3">
        <Card title="How this protects your vote">
          <ul className="space-y-3 font-sans text-sm text-ink/85">
            <li>
              <strong className="block text-ink">Secrecy</strong>
              The roster table and the ballot table have no column that joins them. No query can
              name how you voted, even with full database access.
            </li>
            <li>
              <strong className="block text-ink">Your receipt</strong>
              Sealing gives you a receipt code hashed from your ballot. It proves your ballot is in
              the count without revealing its contents, so nobody can buy your vote with it.
            </li>
            <li>
              <strong className="block text-ink">One ballot per student</strong>
              The roster is claimed and the ballot is sealed in a single transaction. A second
              attempt changes zero rows and is refused.
            </li>
            <li>
              <strong className="block text-ink">Counted, not guessed</strong>
              Single-seat posts use instant runoff, multi-seat posts use approval. Ties are declared
              instead of quietly broken.
            </li>
          </ul>
        </Card>

        <Card title="Casting on paper instead?" eyebrow="No account needed">
          <p className="font-sans text-sm text-ink/80">
            Anyone can check whether a ballot is in the count, and read the full receipt list, on
            the{' '}
            <Link to="/verify" className="font-semibold text-pine underline underline-offset-2">
              receipt checker
            </Link>
            .
          </p>
        </Card>

        {mode === 'offline' ? (
          <Alert tone="warn" title="Demo mode">
            No server answered, so this browser is running the whole election system locally. Every
            action works; nothing leaves this machine.
          </Alert>
        ) : null}
      </aside>
    </div>
  )
}
