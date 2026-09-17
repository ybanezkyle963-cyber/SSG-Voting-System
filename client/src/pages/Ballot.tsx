import { useEffect, useState } from 'react'
import { Link, navigate } from '../lib/router'
import { api } from '../lib/api'
import { copyText, when } from '../lib/format'
import type { Ballot as Paper, Choices, Position, Receipt } from '../lib/types'
import { useAuth } from '../state/AuthContext'
import { useToast } from '../state/ToastContext'
import { ReceiptQr } from '../components/ReceiptQr'
import { Alert, Button, Card, Empty, Modal, Spinner, Tag } from '../components/ui'

/* The stub is the one object a voter keeps, so it survives a reload. */
const STUB_KEY = 'ssg-stub-v1'

function readStub(studentNo: string | undefined): Receipt | null {
  if (!studentNo) return null
  try {
    const all = JSON.parse(localStorage.getItem(STUB_KEY) ?? '{}') as Record<string, Receipt>
    return all[studentNo] ?? null
  } catch {
    return null
  }
}

function writeStub(studentNo: string, receipt: Receipt) {
  try {
    const all = JSON.parse(localStorage.getItem(STUB_KEY) ?? '{}') as Record<string, Receipt>
    all[studentNo] = receipt
    localStorage.setItem(STUB_KEY, JSON.stringify(all))
  } catch {
    /* the stub is a convenience; the receipt code is the real artifact */
  }
}

export function Ballot() {
  const { session, refreshStatus, markVoted } = useAuth()
  const { notify } = useToast()

  const voting = session?.role === 'voter' && !session.hasVoted

  const [paper, setPaper] = useState<Paper | null>(null)
  const [error, setError] = useState('')
  const [choices, setChoices] = useState<Choices>({})
  const [step, setStep] = useState<'mark' | 'review'>('mark')
  const [sealedNow, setSealedNow] = useState<Receipt | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sealing, setSealing] = useState(false)

  useEffect(() => {
    if (!voting || !session) return
    let cancelled = false
    api
      .ballot(session.token)
      .then((next) => {
        if (!cancelled) setPaper(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The ballot could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [session, voting])

  // Everything about "have they voted?" is derived from one place, so the screen
  // can never disagree with the roster or with the stub saved on this device.
  const receipt = sealedNow ?? readStub(session?.studentNo)
  const hasVoted = !!(sealedNow || session?.hasVoted || paper?.hasVoted)
  const loading = voting && !paper && !error

  if (!session) {
    return (
      <div className="mx-auto max-w-lg">
        <Card title="Sign in to vote">
          <p className="font-sans text-sm text-ink/80">
            The ballot only appears for a signed-in student on the roster.
          </p>
          <div className="mt-3">
            <Link to="/">
              <Button variant="primary">Go to sign in</Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  if (session.role !== 'voter') {
    return (
      <div className="mx-auto max-w-lg">
        <Card title="Committee accounts do not vote">
          <p className="font-sans text-sm text-ink/80">
            Your account runs the election. Use the control panel instead.
          </p>
          <div className="mt-3">
            <Link to="/control">
              <Button variant="seal">Election control</Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  const toggle = (post: Position, candidateId: string) => {
    const current = choices[post.id] ?? []
    const full = post.method === 'approval' && current.length >= post.seats
    const alreadyPicked = current.includes(candidateId)

    if (full && !alreadyPicked) {
      notify(
        `${post.title} allows at most ${post.seats} choices. Deselect someone to change your pick.`,
        'warn'
      )
      return
    }

    // The updater re-checks the seat cap against the latest state, so two taps
    // landing in the same batch can never push a post over its limit — the
    // server would refuse such a ballot, and losing a marked ballot that way
    // would be the voter's problem to discover only at sealing time.
    setChoices((prev) => {
      const list = prev[post.id] ?? []
      if (list.includes(candidateId)) {
        return { ...prev, [post.id]: list.filter((id) => id !== candidateId) }
      }
      if (post.method === 'approval' && list.length >= post.seats) return prev
      return { ...prev, [post.id]: [...list, candidateId] }
    })
  }

  const clear = (post: Position) => {
    setChoices((prev) => ({ ...prev, [post.id]: [] }))
  }

  const seal = async () => {
    setSealing(true)
    try {
      const sealed = await api.vote(session.token, choices)
      if (session.studentNo) writeStub(session.studentNo, sealed)
      setSealedNow(sealed)
      markVoted()
      setConfirming(false)
      notify('Ballot sealed. This action cannot be undone.', 'success')
      await refreshStatus()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The ballot could not be sealed.', 'error')
      setConfirming(false)
    } finally {
      setSealing(false)
    }
  }

  /* -------------------------------------------------------------- sealed view */

  if (hasVoted) {
    // Only meaningful for the voter who just sealed on this device; a returning
    // voter has no marking state to report, and guessing would be a lie.
    const abstained = sealedNow
      ? (paper?.positions.length ?? 0) - Object.values(choices).filter((v) => v.length > 0).length
      : 0
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card
          className={`print-stub ${sealedNow ? 'seal-stamp' : ''}`}
          eyebrow="Detachable stub — keep this"
          title="Your ballot is sealed"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label">Serial number</p>
              <p className="numeric break-all text-2xl font-semibold tracking-wider text-ink">
                {receipt?.serial ?? '—'}
              </p>
            </div>
            <div>
              <p className="label">Sealed at</p>
              <p className="font-sans text-sm text-ink">{when(receipt?.sealedAt)}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="label">Receipt code</p>
              <p className="numeric break-all border border-rule bg-white px-3 py-2 text-sm text-ink">
                {receipt?.receipt ?? 'Not shown on this device.'}
              </p>
            </div>

            {/* Printed with the stub on purpose: the code is the part a voter
                would otherwise have to retype on a phone. */}
            {receipt ? (
              <div className="border-t border-dashed border-rule pt-4 sm:col-span-2">
                <ReceiptQr receipt={receipt.receipt} />
                <p className="mt-2 font-sans text-[11px] text-ink-60">
                  The scan carries your receipt code and nothing else — your choices cannot be read
                  from the stub.
                </p>
              </div>
            ) : null}
          </div>

          {receipt ? (
            <div className="no-print mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const done = await copyText(receipt.receipt)
                  notify(done ? 'Receipt code copied.' : 'Copying is blocked in this browser.', done ? 'success' : 'warn')
                }}
              >
                Copy receipt code
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                Print the stub
              </Button>
              <Link to={`/verify?receipt=${encodeURIComponent(receipt.receipt)}`}>
                <Button size="sm" variant="primary">
                  Check it in the count
                </Button>
              </Link>
            </div>
          ) : null}
        </Card>

        <div className="no-print space-y-3">
          <Alert tone="success" title="Recorded without revealing your choices">
            The roster now shows that you voted. The ballot itself carries only a random serial and
            this hashed receipt — no student number, no timestamp precise enough to match you. Your
            session token was deleted the moment the ballot was sealed.
          </Alert>

          <Card title="What happens next">
            <ol className="space-y-2 font-sans text-sm text-ink/85">
              <li>
                <strong className="text-ink">1.</strong> Scan the QR symbol above with a phone, or
                paste the receipt code into the checker, any time before certification to confirm
                your ballot is still in the box.
              </li>
              <li>
                <strong className="text-ink">2.</strong> The committee dashboard reconciles the
                roster against the sealed ballots. Two numbers that must match.
              </li>
              <li>
                <strong className="text-ink">3.</strong> When voting closes and results are
                published, the full count — every runoff round included — is readable on the
                results page.
              </li>
            </ol>
            {abstained > 0 ? (
              <p className="mt-3 font-sans text-sm text-ink-60">
                You left {abstained} {abstained === 1 ? 'post' : 'posts'} unmarked.{' '}
                {abstained === 1 ? 'It is' : 'They are'} recorded as a deliberate abstention, not
                discarded.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/results">
                <Button>See the results</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  /* ---------------------------------------------------------------- load view */

  if (loading) {
    return (
      <div className="py-10 text-center">
        <Spinner label="Fetching the ballot" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <Alert tone="error" title="Ballot unavailable">
          {error}
        </Alert>
        <Button onClick={() => navigate('/')}>Back to sign in</Button>
      </div>
    )
  }

  if (!paper) return <Empty>The ballot is empty. Ask the committee to publish the slate.</Empty>

  const marked = paper.positions.filter((p) => (choices[p.id]?.length ?? 0) > 0).length
  const total = paper.positions.length

  /* -------------------------------------------------------------- review view */

  if (step === 'review') {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl">Check your ballot before sealing</h1>
          <p className="mt-1 font-sans text-sm text-ink-60">
            Sealing cannot be undone and cannot be repeated. Read this once more.
          </p>
        </div>

        <Card>
          <ul className="divide-y divide-rule">
            {paper.positions.map((post) => {
              const picks = choices[post.id] ?? []
              return (
                <li key={post.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-ink">{post.title}</p>
                  {picks.length === 0 ? (
                    <p className="mt-1 font-sans text-sm italic text-ink-60">
                      Not marked — recorded as an abstention
                    </p>
                  ) : (
                    <ol className="mt-1 space-y-0.5 font-sans text-sm text-ink/85">
                      {picks.map((id, i) => {
                        const candidate = post.candidates.find((c) => c.id === id)
                        return (
                          <li key={id}>
                            {post.method === 'irv' ? (
                              <span className="numeric mr-2 inline-block w-4 text-ink-60">{i + 1}.</span>
                            ) : (
                              <span className="mr-2 text-gold" aria-hidden="true">
                                ●
                              </span>
                            )}
                            {candidate?.name}
                            <span className="ml-2 text-xs text-ink-60">{candidate?.party}</span>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setStep('mark')}>Back to the ballot</Button>
          <Button variant="seal" onClick={() => setConfirming(true)}>
            Seal my ballot
          </Button>
          {marked < total ? (
            <span className="font-sans text-xs text-ink-60">
              {total - marked} unmarked {total - marked === 1 ? 'post counts' : 'posts count'} as
              abstention
            </span>
          ) : null}
        </div>

        <Modal
          open={confirming}
          title="Seal this ballot?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)} disabled={sealing}>
                Go back
              </Button>
              <Button variant="seal" onClick={seal} disabled={sealing}>
                {sealing ? 'Sealing' : 'Yes, seal it'}
              </Button>
            </>
          }
        >
          <p className="font-sans text-sm text-ink/85">
            The roster will be marked, the ballot will be sealed, and your session will be closed.
            You cannot vote again, and you cannot change this ballot. Your receipt code appears on
            the next screen — write it down.
          </p>
        </Modal>
      </div>
    )
  }

  /* ---------------------------------------------------------------- mark view */

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Official ballot</h1>
          <p className="mt-1 max-w-prose font-sans text-sm text-ink-60">
            Ranked posts: tap in order of preference, a second tap removes. Multi-seat posts: mark
            everyone you would accept for office. Leaving a post blank is allowed and counted.
          </p>
        </div>
        <Tag tone={paper.open ? 'pine' : 'seal'}>
          {paper.open ? 'Voting is open' : 'Voting is closed'}
        </Tag>
      </div>

      {!paper.open ? (
        <Alert tone="warn" title="Voting is closed">
          The ballot is shown for reference only. The server will refuse a sealed ballot while the
          election is closed.
        </Alert>
      ) : null}

      {paper.positions.map((post) => {
        const picks = choices[post.id] ?? []
        return (
          <article key={post.id} className="card">
            <header className="flex flex-wrap items-end justify-between gap-2 border-b border-rule px-4 py-3">
              <div>
                <h2 className="text-lg leading-tight">{post.title}</h2>
                <p className="font-sans text-xs text-ink-60">
                  {post.method === 'irv'
                    ? 'Rank as many as you like · instant runoff'
                    : `Choose up to ${post.seats} · approval voting`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tag tone={picks.length ? 'gold' : 'plain'}>
                  {picks.length ? `${picks.length} marked` : 'Not marked'}
                </Tag>
                {picks.length ? (
                  <Button size="sm" onClick={() => clear(post)}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </header>

            <ul className="divide-y divide-rule">
              {post.candidates.map((candidate) => {
                const index = picks.indexOf(candidate.id)
                const selected = index >= 0
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(post, candidate.id)}
                      disabled={!paper.open}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink/[0.03] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                    >
                      <span
                        className={`oval ${
                          selected
                            ? post.method === 'irv'
                              ? 'oval-ranked'
                              : 'oval-approved'
                            : 'oval-idle'
                        }`}
                        aria-hidden="true"
                      >
                        {post.method === 'irv' && selected ? (
                          <span className="numeric text-sm font-bold">{index + 1}</span>
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold text-ink">{candidate.name}</span>
                        <span className="ml-2 font-sans text-xs text-ink-60">
                          {candidate.party} · {candidate.yearLevel}
                        </span>
                        <span className="mt-0.5 block font-sans text-sm text-ink/75">
                          {candidate.platform}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </article>
        )
      })}

      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-[12rem] flex-1">
            <p className="numeric font-sans text-sm font-semibold text-ink">
              {marked} of {total} posts marked
            </p>
            <div className="mt-1 h-1.5 w-full max-w-xs border border-rule bg-white">
              <div
                className="h-full bg-gold"
                style={{ width: `${total ? (marked / total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {marked < total ? (
              <span className="font-sans text-xs text-ink-60">
                {total - marked} still blank
              </span>
            ) : null}
            <Button variant="primary" onClick={() => setStep('review')}>
              Review and seal
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
