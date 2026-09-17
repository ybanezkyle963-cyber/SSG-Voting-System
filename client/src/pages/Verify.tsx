import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { RawReceipt } from '../lib/api'
import { when } from '../lib/format'
import type { ReceiptLookup } from '../lib/types'
import { useToast } from '../state/ToastContext'
import { Alert, Button, Card, Empty, Field, Spinner, Tag } from '../components/ui'

export function Verify() {
  const { notify } = useToast()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ReceiptLookup | null>(null)
  const [checked, setChecked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [list, setList] = useState<RawReceipt[] | null>(null)
  const [listError, setListError] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .receipts()
      .then((r) => {
        if (!cancelled) setList(r.receipts)
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : 'The list is unavailable.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const check = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const found = await api.verify(trimmed)
      setResult(found)
      setChecked(trimmed)
      notify(
        found.found ? 'That ballot is in the sealed box.' : 'That code is not in the sealed box.',
        found.found ? 'success' : 'error'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check failed.')
    } finally {
      setBusy(false)
    }
  }

  const filtered = (list ?? []).filter((r) =>
    filter.trim() ? r.receipt.toLowerCase().includes(filter.trim().toLowerCase()) : true
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl">Check a receipt</h1>
          <p className="mt-1 max-w-prose font-sans text-sm text-ink-60">
            Paste the receipt code from your stub. This tells you whether a ballot with exactly
            those choices is still in the box. It cannot be reversed into your choices, which is
            what makes it safe to show anyone.
          </p>
        </div>

        <Card title="Receipt lookup" eyebrow="Works without signing in">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="Receipt code"
                placeholder="paste the code from your stub"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void check(code)
                }}
                className="numeric"
              />
            </div>
            <Button variant="primary" onClick={() => void check(code)} disabled={busy || !code.trim()}>
              Check
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {busy ? <Spinner label="Scanning the sealed box" /> : null}
            {error ? <Alert tone="error">{error}</Alert> : null}

            {result?.found ? (
              <Alert tone="success" title="Your ballot is in the count.">
                <p className="numeric break-all">Receipt: {checked}</p>
                <p className="numeric">Serial {result.serial}</p>
                <p>Sealed {when(result.sealed_at)}</p>
                <p className="mt-2 font-sans text-xs">
                  A ballot with exactly these choices is sealed and will be counted. Nothing here
                  reveals what those choices were.
                </p>
              </Alert>
            ) : null}

            {result && !result.found ? (
              <Alert tone="error" title="No ballot carries that code.">
                Check for a typo or a missing character. If the code is correct, tell the committee
                immediately — a missing receipt must be explained before the count is certified.
              </Alert>
            ) : null}
          </div>
        </Card>

        <Card
          title="The full receipt list"
          eyebrow="Independent checking"
          actions={
            list ? <Tag tone="pine">{list.length} sealed</Tag> : null
          }
        >
          <p className="font-sans text-sm text-ink/80">
            Every receipt in the box, in sealing order. Compare it against the printed list the
            committee publishes at close — if a ballot was quietly deleted, it is missing here and
            the roster stops reconciling.
          </p>

          <div className="mt-3">
            <Field
              label="Filter"
              placeholder="type a few characters"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="numeric"
            />
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto border border-rule bg-white/70">
            {listError ? (
              <p className="px-3 py-4 font-sans text-sm text-ink-60">{listError}</p>
            ) : !list ? (
              <p className="px-3 py-4">
                <Spinner label="Loading the list" />
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 font-sans text-sm text-ink-60">
                {list.length === 0 ? 'No ballots are sealed yet.' : 'No receipt matches that filter.'}
              </p>
            ) : (
              <ul className="divide-y divide-rule">
                {filtered.map((r) => (
                  <li key={r.receipt} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCode(r.receipt)
                        void check(r.receipt)
                      }}
                      className="numeric break-all text-left text-xs text-pine underline underline-offset-2"
                      title="Load this receipt into the checker"
                    >
                      {r.receipt}
                    </button>
                    <span className="font-sans text-[11px] text-ink-60">{when(r.sealed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <aside className="space-y-3">
        <Card title="What this proves — and what it does not">
          <ul className="space-y-3 font-sans text-sm text-ink/85">
            <li>
              <strong className="block text-ink">Proves</strong>
              A ballot with your exact set of choices is sealed and in the box.
            </li>
            <li>
              <strong className="block text-ink">Does not prove</strong>
              Who cast it. The receipt contains no student number, so it cannot be used to prove how
              you voted to anyone offering you something for it.
            </li>
            <li>
              <strong className="block text-ink">Before certification</strong>
              Check it once more on the day results are published, against the frozen list — not
              against the running count.
            </li>
          </ul>
        </Card>

        {!list ? (
          <Empty>The published list appears here once the system answers.</Empty>
        ) : (
          <Alert tone="info" title="Tip">
            Receipt codes are hashes of your choices and serial. Two voters who marked identical
            ballots still get different codes because the serials differ.
          </Alert>
        )}
      </aside>
    </div>
  )
}
