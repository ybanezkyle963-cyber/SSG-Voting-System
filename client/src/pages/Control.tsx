import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { DEFAULT_CONTROL_CODE, tamperWithLog } from '../lib/offline'
import { eventLabel, plural, shortHash, when } from '../lib/format'
import { Link } from '../lib/router'
import type { AuditReport } from '../lib/types'
import { useAuth } from '../state/AuthContext'
import { useToast } from '../state/ToastContext'
import { Alert, Button, Card, Empty, Field, Modal, Spinner, Stat, Tag } from '../components/ui'

type Tab = 'dashboard' | 'audit' | 'settings'

export function Control() {
  const {
    session,
    mode,
    status,
    controlOpen,
    unlockControl,
    lockControl,
    setElection,
    signOutToOffline
  } = useAuth()
  const { notify } = useToast()

  const [code, setCode] = useState('')
  const [gateError, setGateError] = useState('')
  const [gateBusy, setGateBusy] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const [tab, setTab] = useState<Tab>('dashboard')
  const [audit, setAudit] = useState<AuditReport | null>(null)
  const [auditError, setAuditError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const [newCode, setNewCode] = useState('')
  const [rotating, setRotating] = useState(false)

  const loadAudit = useCallback(async () => {
    if (!session || session.role !== 'committee' || !controlOpen) return
    try {
      const next = await api.audit(session.token)
      setAudit(next)
      setAuditError('')
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'The audit log could not be read.')
    }
  }, [session, controlOpen])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  const submitGate = async (e: FormEvent) => {
    e.preventDefault()
    setGateBusy(true)
    setGateError('')
    try {
      const result = await unlockControl(code)
      if (result === 'ok') {
        setCode('')
        setAttempts(0)
        notify('Election control unlocked.', 'success')
      } else {
        setAttempts((n) => n + 1)
        setGateError('That entry code is not recognised.')
      }
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'The code could not be checked.')
    } finally {
      setGateBusy(false)
    }
  }

  /* ------------------------------------------------------------------- access */

  if (!session) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <Card title="Election control is for the committee" eyebrow="Restricted">
          <p className="font-sans text-sm text-ink/80">
            Sign in with a committee account. A second entry code is required even then, so a
            committee member who leaves a laptop unlocked cannot open the count.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/">
              <Button variant="primary">Sign in</Button>
            </Link>
            <Link to="/results">
              <Button>Public results</Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  if (session.role !== 'committee') {
    return (
      <div className="mx-auto max-w-lg">
        <Alert tone="error" title="Committee sign-in required">
          Your account is a voter account. Election control — opening, closing, publishing, and the
          audit log — is limited to committee members.
        </Alert>
      </div>
    )
  }

  if (!controlOpen) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Card title="Enter the election control code" eyebrow={`Signed in as ${session.name}`}>
          <form onSubmit={submitGate} className="space-y-4">
            <Field
              label="Entry code"
              type="password"
              autoComplete="off"
              placeholder="••••••••"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              hint="Held by the committee chair, separate from your sign-in."
            />
            {gateError ? <Alert tone="error">{gateError}</Alert> : null}
            {attempts >= 3 ? (
              <Alert tone="warn" title="Three failed attempts">
                A real deployment would lock this account and require the chair to release it in
                person.
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="seal" disabled={gateBusy || !code.trim()}>
                {gateBusy ? 'Checking' : 'Unlock control'}
              </Button>
              <Link to="/results">
                <Button>Back to results</Button>
              </Link>
            </div>
          </form>

          {mode === 'offline' ? (
            <div className="mt-4 border-t border-rule pt-3">
              <p className="font-sans text-xs text-ink-60">
                Offline demo — the control code is{' '}
                <span className="numeric font-semibold text-ink">{DEFAULT_CONTROL_CODE}</span>. Change
                it under the settings tab.
              </p>
            </div>
          ) : null}
        </Card>

        <Alert tone="info" title="Why a second code">
          The dangerous actions here are irreversible: closing voting, publishing a count, and
          reading the audit log. A code known only to the chair keeps that authority from travelling
          with a shared committee login.
        </Alert>
      </div>
    )
  }

  /* -------------------------------------------------------------------- panel */

  const electionOpen = status?.open ?? false
  const published = status?.resultsPublished ?? false
  const chain = audit?.chain
  const turnout = audit?.turnout ?? status?.turnout

  const toggleOpen = async (open: boolean) => {
    setBusy(true)
    try {
      await setElection({ open })
      await loadAudit()
      notify(open ? 'Voting is now open.' : 'Voting is now closed.', open ? 'success' : 'warn')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The change failed.', 'error')
    } finally {
      setBusy(false)
      setConfirmClose(false)
    }
  }

  const togglePublish = async (publishResults: boolean) => {
    setBusy(true)
    try {
      await setElection({ publishResults })
      await loadAudit()
      notify(publishResults ? 'Results are public.' : 'Results withdrawn.', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The change failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (e: FormEvent) => {
    e.preventDefault()
    setRotating(true)
    try {
      await api.rotateCode(session.token, newCode)
      setNewCode('')
      await loadAudit()
      notify('Control code changed.', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The code could not be changed.', 'error')
    } finally {
      setRotating(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Election control</h1>
          <p className="mt-1 font-sans text-sm text-ink-60">
            Signed in as {session.name} · gate unlocked for this browser session
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={electionOpen ? 'pine' : 'seal'}>
            {electionOpen ? 'Voting open' : 'Voting closed'}
          </Tag>
          <Tag tone={published ? 'gold' : 'plain'}>{published ? 'Results public' : 'Results held'}</Tag>
          <Button size="sm" onClick={lockControl}>
            Re-lock gate
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Control sections" className="flex gap-1 border-b border-rule">
        {(
          [
            ['dashboard', 'Dashboard'],
            ['audit', 'Audit log'],
            ['settings', 'Demo settings']
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 font-sans text-xs font-semibold uppercase tracking-[0.14em] transition ${
              tab === key
                ? 'border-seal text-seal'
                : 'border-transparent text-ink-60 hover:border-rule hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Registered" value={turnout?.registered ?? '—'} />
            <Stat label="Roster marked" value={turnout?.voted ?? '—'} />
            <Stat label="Ballots sealed" value={turnout?.sealed ?? '—'} />
            <Stat label="Turnout" value={turnout ? `${turnout.percent}%` : '—'} tone="pine" />
          </div>

          {turnout ? (
            turnout.reconciled ? (
              <Alert tone="success" title="Roster and ballot box reconcile">
                {plural(turnout.voted, 'voter')} marked as having voted,{' '}
                {plural(turnout.sealed, 'ballot')} sealed. Nothing to explain.
              </Alert>
            ) : (
              <Alert tone="error" title="Do not certify this count">
                {plural(turnout.voted, 'voter')} marked but only{' '}
                {plural(turnout.sealed, 'ballot')} sealed. The difference is{' '}
                {Math.abs(turnout.voted - turnout.sealed)} and must be accounted for before a single
                result is announced.
              </Alert>
            )
          ) : null}

          {chain ? (
            chain.ok ? (
              <Alert tone="success" title="Audit log intact">
                {chain.entries} entries, hash-chained from genesis. Head{' '}
                <span className="numeric">{shortHash(chain.head, 16)}</span>
              </Alert>
            ) : (
              <Alert tone="error" title={`Audit log broken at entry #${chain.brokenAt}`}>
                Someone edited or removed an entry. The result cannot be defended until the log is
                explained.
              </Alert>
            )
          ) : null}

          <Card title="Open and close voting" eyebrow="Consequential">
            <p className="font-sans text-sm text-ink/80">
              Closing voting stops accepting ballots immediately. Every open and close is written to
              the audit log with your account.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy || electionOpen}
                onClick={() => void toggleOpen(true)}
              >
                Open voting
              </Button>
              <Button
                variant="seal"
                disabled={busy || !electionOpen}
                onClick={() => setConfirmClose(true)}
              >
                Close voting
              </Button>
            </div>
          </Card>

          <Card title="Publish the count" eyebrow="Results visibility">
            <p className="font-sans text-sm text-ink/80">
              While held, only committee accounts can read the count — candidates cannot be told the
              standings mid-vote. Publishing is logged.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy || published}
                onClick={() => void togglePublish(true)}
              >
                Publish results
              </Button>
              <Button disabled={busy || !published} onClick={() => void togglePublish(false)}>
                Withdraw them
              </Button>
              <Link to="/results">
                <Button>Preview as published</Button>
              </Link>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-sans text-xs text-ink-60">
              Newest first. Ballot entries record a serial and receipt only — never a student number.
            </p>
            <div className="flex flex-wrap gap-2">
              {mode === 'offline' ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const seq = tamperWithLog()
                    void loadAudit()
                    notify(
                      seq ? `Entry #${seq} edited in the database. Watch the chain break.` : 'Nothing to edit yet.',
                      'warn'
                    )
                  }}
                >
                  Simulate tampering
                </Button>
              ) : null}
              <Button size="sm" onClick={() => void loadAudit()}>
                Re-verify chain
              </Button>
            </div>
          </div>

          {auditError ? <Alert tone="error">{auditError}</Alert> : null}

          {chain ? (
            chain.ok ? (
              <Alert tone="success" title="Every entry verifies">
                {chain.entries} entries recomputed from the genesis block. Head hash{' '}
                <span className="numeric">{shortHash(chain.head, 16)}</span>
              </Alert>
            ) : (
              <Alert tone="error" title={`Chain broken at entry #${chain.brokenAt}`}>
                Everything from entry #{chain.brokenAt} onward is untrustworthy. A single edited
                timestamp or deleted row is enough to do this — which is the point: it cannot be
                hidden.
              </Alert>
            )
          ) : null}

          {!audit ? (
            <Spinner label="Recomputing the hash chain" />
          ) : audit.entries.length === 0 ? (
            <Empty>The log is empty.</Empty>
          ) : (
            <div className="overflow-x-auto border border-rule bg-white/70">
              <table className="w-full min-w-[40rem] border-collapse text-left font-sans text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th scope="col" className="px-3 py-2 text-xs uppercase tracking-[0.14em] text-ink-60">
                      #
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs uppercase tracking-[0.14em] text-ink-60">
                      When
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs uppercase tracking-[0.14em] text-ink-60">
                      Event
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs uppercase tracking-[0.14em] text-ink-60">
                      Detail
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs uppercase tracking-[0.14em] text-ink-60">
                      Entry hash
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audit.entries.map((entry) => {
                    const broken = chain && !chain.ok && chain.brokenAt === entry.seq
                    return (
                      <tr
                        key={entry.seq}
                        className={`border-b border-rule/70 ${broken ? 'bg-seal/10' : ''}`}
                      >
                        <td className="numeric px-3 py-2 text-ink-60">{entry.seq}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-ink-60">
                          {when(entry.at)}
                        </td>
                        <td className="px-3 py-2 font-medium text-ink">
                          {eventLabel(entry.event)}
                          {broken ? (
                            <span className="ml-2">
                              <Tag tone="seal">first break</Tag>
                            </span>
                          ) : null}
                        </td>
                        <td className="numeric px-3 py-2 text-xs text-ink-60">{entry.detail}</td>
                        <td className="numeric px-3 py-2 text-xs text-ink-60">
                          {shortHash(entry.entry_hash)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="space-y-5">
          <Card title="Change the control code" eyebrow="Gate">
            <p className="font-sans text-sm text-ink/80">
              Everyone who needs the control panel should learn the code in person, not here. Six
              characters minimum; letters, numbers and dashes only.
            </p>
            <form onSubmit={rotate} className="mt-3 max-w-sm space-y-3">
              <Field
                label="New entry code"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="SSG-2026"
                hint={mode === 'offline' ? `Demo default: ${DEFAULT_CONTROL_CODE}` : undefined}
              />
              <Button type="submit" variant="seal" disabled={rotating || newCode.trim().length < 6}>
                {rotating ? 'Changing' : 'Change code'}
              </Button>
            </form>
          </Card>

          {mode === 'offline' ? (
            <Card title="Reset the demo" eyebrow="Offline only">
              <p className="font-sans text-sm text-ink/80">
                Clears the local roster, every sealed ballot and the audit log, then reseeds the
                same slate the server seeds — 180 voters, 7 posts, 19 candidates. The control code
                returns to{' '}
                <span className="numeric font-semibold">{DEFAULT_CONTROL_CODE}</span>.
              </p>
              <div className="mt-3">
                <Button
                  variant="seal"
                  onClick={() => {
                    signOutToOffline()
                    notify('Demo data reset. Sign in again.', 'info')
                  }}
                >
                  Reset everything
                </Button>
              </div>
            </Card>
          ) : (
            <Alert tone="info" title="Server-side gate">
              This deployment has no <span className="numeric">/api/admin/gate</span> route, so the
              entry code is checked against the value compiled into this build
              (<span className="numeric">VITE_CONTROL_CODE</span>). Add the route to the server to
              move the check where it belongs.
            </Alert>
          )}
        </div>
      ) : null}

      <Modal
        open={confirmClose}
        title="Close voting?"
        onClose={() => setConfirmClose(false)}
        footer={
          <>
            <Button onClick={() => setConfirmClose(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="seal" onClick={() => void toggleOpen(false)} disabled={busy}>
              {busy ? 'Closing' : 'Close voting now'}
            </Button>
          </>
        }
      >
        <p className="font-sans text-sm text-ink/85">
          The server will refuse every further ballot. Students still marking a ballot will lose it.
          This is logged against your account and is reversible only by reopening — which is also
          logged.
        </p>
      </Modal>
    </div>
  )
}
