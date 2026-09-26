import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { eventLabel, plural, shortHash, when } from '../lib/format'
import { Link } from '../lib/router'
import type { AuditReport } from '../lib/types'
import { useAuth } from '../state/AuthContext'
import { useToast } from '../state/ToastContext'
import { Alert, Button, Card, Empty, Modal, Spinner, Stat, Tag } from '../components/ui'

type Tab = 'dashboard' | 'audit'

export function Control() {
  const { session, status, setElection } = useAuth()
  const { notify } = useToast()

  const [tab, setTab] = useState<Tab>('dashboard')
  const [audit, setAudit] = useState<AuditReport | null>(null)
  const [auditError, setAuditError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const loadAudit = useCallback(async () => {
    if (!session || session.role !== 'committee') return
    try {
      const next = await api.audit(session.token)
      setAudit(next)
      setAuditError('')
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'The audit log could not be read.')
    }
  }, [session])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  /* ------------------------------------------------------------------- access */

  if (!session) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <Card title="Election control is for the committee" eyebrow="Restricted">
          <p className="font-sans text-sm text-ink/80">
            Sign in with the committee account to open, close and publish the election, and to read
            the audit log.
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Election control</h1>
          <p className="mt-1 font-sans text-sm text-ink-60">Signed in as {session.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={electionOpen ? 'pine' : 'seal'}>
            {electionOpen ? 'Voting open' : 'Voting closed'}
          </Tag>
          <Tag tone={published ? 'gold' : 'plain'}>{published ? 'Results public' : 'Results held'}</Tag>
          <Button size="sm" onClick={() => void loadAudit()}>
            Refresh
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Control sections" className="flex gap-1 border-b border-rule">
        {(
          [
            ['dashboard', 'Dashboard'],
            ['audit', 'Audit log']
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
            <Button size="sm" onClick={() => void loadAudit()}>
              Re-verify chain
            </Button>
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
