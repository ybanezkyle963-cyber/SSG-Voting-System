import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { plural, shortHash } from '../lib/format'
import type { PositionResult, ResultsReport, Round } from '../lib/types'
import { useAuth } from '../state/AuthContext'
import { Link } from '../lib/router'
import { Alert, BarRow, Button, Card, Empty, Spinner, Stat, Tag } from '../components/ui'

export function Results() {
  const { session, status } = useAuth()
  const [report, setReport] = useState<ResultsReport | null>(null)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await api.results(session?.token)
      setReport(next)
      setLocked(false)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLocked(true)
        setError('')
      } else {
        setError(err instanceof Error ? err.message : 'The count could not be loaded.')
      }
    }
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  // Derived from what actually arrived, so the spinner and the report can never
  // both be absent while something is still in flight.
  const loading = !report && !error && !locked

  const rerun = async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="py-10 text-center">
        <Spinner label="Re-running the count" />
      </div>
    )
  }

  if (locked) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Card title="Results are sealed until the committee publishes them" eyebrow="Not yet released">
          <p className="font-sans text-sm text-ink/80">
            Candidates cannot be told the standings mid-vote, so the count stays closed until voting
            ends. Once it is published, every runoff round and every abstention is readable here.
          </p>
          {session?.role === 'committee' ? (
            <div className="mt-4">
              <Link to="/control">
                <Button variant="seal">Publish from election control</Button>
              </Link>
            </div>
          ) : null}
        </Card>
        <Alert tone="info" title="Turnout is public either way">
          {status
            ? `${status.turnout.voted} of ${status.turnout.registered} voters have cast a ballot (${status.turnout.percent}%).`
            : 'Turnout appears in the masthead while the count is closed.'}
        </Alert>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <Alert tone="error" title="Count unavailable">
          {error}
        </Alert>
        <Button onClick={() => void rerun()}>Try again</Button>
      </div>
    )
  }

  if (!report) return <Empty>No count to show.</Empty>

  const { turnout, chain, results } = report

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Canvass report</h1>
          <p className="mt-1 max-w-prose font-sans text-sm text-ink-60">
            Counted from the sealed ballots only. Same ballots in, same result out — anyone with the
            ballot export can re-run this and must get the same numbers.
          </p>
        </div>
        <Button size="sm" onClick={() => void rerun()} disabled={refreshing}>
          {refreshing ? 'Re-running' : 'Re-run the count'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Registered" value={turnout.registered} />
        <Stat label="Roster marked" value={turnout.voted} />
        <Stat label="Ballots sealed" value={turnout.sealed} />
        <Stat
          label="Turnout"
          value={`${turnout.percent}%`}
          tone={turnout.percent >= 50 ? 'pine' : 'plain'}
        />
      </div>

      <div className="space-y-2">
        {turnout.reconciled ? (
          <Alert tone="success" title="Roster and ballot box reconcile">
            {plural(turnout.voted, 'student')} marked as having voted,{' '}
            {plural(turnout.sealed, 'ballot')} sealed. This count may be certified.
          </Alert>
        ) : (
          <Alert tone="error" title="Do not certify this count">
            The roster shows {plural(turnout.voted, 'voter')} but the box holds{' '}
            {plural(turnout.sealed, 'ballot')}. The two must match exactly; a gap means ballots were
            lost, added, or the roster was edited.
          </Alert>
        )}

        {chain.ok ? (
          <Alert tone="success" title="Audit log intact">
            {chain.entries} entries verified from the genesis block. Head hash{' '}
            <span className="numeric">{shortHash(chain.head, 16)}</span>
          </Alert>
        ) : (
          <Alert tone="error" title="Audit log is broken">
            The chain no longer matches, first at entry #{chain.brokenAt}. Every entry after it is
            untrustworthy and the result cannot be defended.
          </Alert>
        )}
      </div>

      {results.map((result) => (
        <PositionCard key={result.positionId} result={result} />
      ))}
    </div>
  )
}

function PositionCard({ result }: { result: PositionResult }) {
  const noBallots = result.ballotsCast === 0
  const decided = result.ballotsCast - result.abstentions

  return (
    <Card
      title={result.title}
      eyebrow={
        result.method === 'irv'
          ? 'Instant runoff · single seat'
          : `Approval voting · ${result.seats} seats to fill`
      }
      actions={
        result.tie ? <Tag tone="seal">Tie declared</Tag> : <Tag tone="pine">Decided</Tag>
      }
    >
      {noBallots ? (
        <Empty>No ballots have been sealed yet.</Empty>
      ) : (
        <div className="space-y-4">
          {result.tie ? (
            <Alert tone="error" title="The count ended level — no winner is named">
              {result.tie.map((c) => c.name).join(' and ')} are tied. The rules say a tie is resolved
              by drawing lots in front of the committee, not by the software quietly choosing.
            </Alert>
          ) : (
            <div>
              <p className="label">{result.winners.length > 1 ? 'Elected' : 'Winner'}</p>
              <ul className="mt-1 space-y-1">
                {result.winners.map((w) => (
                  <li key={w.id} className="text-lg font-semibold text-pine">
                    {w.name}
                    <span className="ml-2 font-sans text-xs font-normal text-ink-60">{w.party}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="font-sans text-xs text-ink-60">
            {plural(result.ballotsCast, 'sealed ballot')} · {decided} marked something ·{' '}
            {result.abstentions} abstained
            {result.abstentions > 0
              ? ` (${((result.abstentions / result.ballotsCast) * 100).toFixed(1)}% deliberately left this post blank)`
              : ''}
          </p>

          {result.method === 'irv' && result.rounds ? (
            <Runoff rounds={result.rounds} />
          ) : null}

          {result.method === 'approval' && result.standing ? (
            <ApprovalTallies result={result} />
          ) : null}
        </div>
      )}
    </Card>
  )
}

function Runoff({ rounds }: { rounds: Round[] }) {
  const final = rounds[rounds.length - 1]
  const earlier = rounds.slice(0, -1)

  return (
    <div className="space-y-4">
      <RoundView round={final} label={`Round ${final.round} — final`} />

      {earlier.length > 0 ? (
        <details className="border border-rule bg-white/60 px-3 py-2">
          <summary className="cursor-pointer font-sans text-xs font-semibold uppercase tracking-[0.14em] text-ink-60">
            Show the {earlier.length} earlier {earlier.length === 1 ? 'round' : 'rounds'}
          </summary>
          <div className="mt-3 space-y-4">
            {earlier.map((round) => (
              <RoundView key={round.round} round={round} label={`Round ${round.round}`} />
            ))}
          </div>
        </details>
      ) : (
        <p className="font-sans text-xs text-ink-60">
          A majority was reached on the first count, so no preferences were transferred.
        </p>
      )}
    </div>
  )
}

function RoundView({ round, label }: { round: Round; label: string }) {
  const max = Math.max(round.active, 1)
  const eliminated = new Set((round.eliminated ?? []).map((e) => e?.id).filter(Boolean) as string[])
  const leaders = round.counts[0]
  const wonHere = (leaders?.votes ?? 0) >= round.majorityNeeded

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-ink-60">
          {label}
        </p>
        <p className="numeric font-sans text-xs text-ink-60">
          {round.active} continuing {round.active === 1 ? 'ballot' : 'ballots'} · majority needs{' '}
          {round.majorityNeeded}
          {round.exhausted ? ` · ${round.exhausted} exhausted` : ''}
        </p>
      </div>

      <ul className="space-y-2">
        {round.counts.map((count) => (
          <li key={count.candidateId}>
            <BarRow
              label={count.name ?? count.candidateId}
              sublabel={count.party}
              votes={count.votes}
              share={count.share}
              max={max}
              threshold={round.majorityNeeded}
              struck={eliminated.has(count.candidateId)}
              winner={wonHere && count.candidateId === leaders?.candidateId}
              tone={eliminated.has(count.candidateId) ? 'gold' : 'pine'}
            />
          </li>
        ))}
      </ul>

      {round.eliminated && round.eliminated.length > 0 ? (
        <p className="font-sans text-xs text-ink-60">
          Nobody cleared {round.majorityNeeded} of {round.active}, so{' '}
          {round.eliminated.map((e) => e?.name ?? e?.id).join(' and ')}{' '}
          {round.eliminated.length === 1 ? 'was' : 'were'} eliminated and{' '}
          {round.eliminated.reduce((total, e) => {
            const row = e ? round.counts.find((c) => c.candidateId === e.id) : undefined
            return total + (row?.votes ?? 0)
          }, 0)}{' '}
          ballots moved to each voter's next surviving choice.
        </p>
      ) : null}
    </div>
  )
}

function ApprovalTallies({ result }: { result: PositionResult }) {
  const standing = result.standing ?? []
  const max = Math.max(...standing.map((s) => s.votes), 1)
  const winners = new Set(result.winners.map((w) => w.id))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-ink-60">
          Approval totals · highest {result.seats} take the seats
        </p>
        <p className="numeric font-sans text-xs text-ink-60">
          {result.ballotsCast - result.abstentions} marking ballots
        </p>
      </div>

      <ul className="space-y-2">
        {standing.map((row, index) => (
          <li key={row.candidateId}>
            {index === result.seats ? (
              <p className="mb-1 mt-3 border-t-2 border-dashed border-ink/40 pt-1 font-sans text-[11px] uppercase tracking-[0.16em] text-ink-60">
                seat cut-off — below this line is out
              </p>
            ) : null}
            <BarRow
              label={row.name ?? row.candidateId}
              sublabel={row.party}
              votes={row.votes}
              share={row.share}
              max={max}
              winner={winners.has(row.candidateId)}
              tone={winners.has(row.candidateId) ? 'pine' : 'gold'}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
