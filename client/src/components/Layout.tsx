import type { ReactNode } from 'react'
import { Link, useRoute } from '../lib/router'
import { useAuth } from '../state/AuthContext'
import { Button, Tag } from './ui'

interface NavItem {
  to: string
  label: string
  committeeOnly?: boolean
  voterOnly?: boolean
}

const NAV: NavItem[] = [
  { to: '/ballot', label: 'Ballot', voterOnly: true },
  { to: '/results', label: 'Results' },
  { to: '/verify', label: 'Check a receipt' },
  { to: '/control', label: 'Election control', committeeOnly: true }
]

export function Layout({ children }: { children: ReactNode }) {
  const { path } = useRoute()
  const { session, status, mode, signOut } = useAuth()

  const items = NAV.filter((item) => {
    if (item.committeeOnly) return session?.role === 'committee'
    if (item.voterOnly) return session?.role === 'voter'
    return true
  })

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="no-print sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:border focus:border-ink focus:bg-paper focus:px-3 focus:py-1 focus:font-sans focus:text-sm"
      >
        Skip to content
      </a>

      <header className="no-print sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <Link to="/" className="group">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-60">
                Supreme Student Government
              </span>
              <span className="block text-2xl font-semibold leading-tight tracking-tight text-ink group-hover:text-pine">
                Election 2026
              </span>
            </Link>

            <div className="flex items-center gap-2">
              {status ? (
                <div className="hidden text-right sm:block">
                  <p className="label">Turnout</p>
                  <p className="numeric text-sm font-semibold text-ink">
                    {status.turnout.voted}/{status.turnout.registered} · {status.turnout.percent}%
                  </p>
                </div>
              ) : null}
              <Tag tone={status?.open ? 'pine' : 'seal'}>
                {status ? (status.open ? 'Voting open' : 'Voting closed') : '—'}
              </Tag>
              {session ? (
                <div className="flex items-center gap-2 border-l border-rule pl-3">
                  <div className="text-right">
                    <p className="font-sans text-sm font-semibold leading-tight text-ink">
                      {session.name}
                    </p>
                    <p className="font-sans text-[11px] uppercase tracking-[0.14em] text-ink-60">
                      {session.role === 'committee' ? 'Committee' : session.yearLevel}
                    </p>
                  </div>
                  <Button size="sm" onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              ) : (
                <Link to="/">
                  <Button size="sm" variant="primary">
                    Sign in
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="perforation mt-3 h-2" aria-hidden="true" />

          <nav aria-label="Sections" className="flex gap-1 overflow-x-auto pb-1 pt-2">
            {items.map((item) => {
              const active = path === item.to || (item.to !== '/' && path.startsWith(item.to))
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 font-sans text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    active
                      ? 'border-pine text-pine'
                      : 'border-transparent text-ink-60 hover:border-rule hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>

      {mode === 'offline' ? (
        <div className="no-print border-b border-gold bg-gold/15">
          <p className="mx-auto w-full max-w-5xl px-4 py-2 font-sans text-xs text-ink sm:px-6">
            <strong className="font-semibold">Offline demo engine.</strong> No election server
            answered on this origin, so ballots, the audit chain and the count are running inside
            this browser and stored locally. Start the server on port 4000 to go live.
          </p>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="no-print border-t border-rule py-5">
        <div className="mx-auto w-full max-w-5xl px-4 font-sans text-xs text-ink-60 sm:px-6">
          <p>
            Your receipt proves your ballot is in the count without revealing what you voted.
            Nothing in this system links a student number to a ballot.
          </p>
          <p className="mt-1">
            {mode === 'live' ? 'Connected to the election server.' : 'Running offline in this browser.'}
            {__BUILD_COMMIT__ ? (
              <>
                {' '}
                Built from commit <span className="numeric">{__BUILD_COMMIT__.slice(0, 7)}</span>.
              </>
            ) : null}
          </p>
        </div>
      </footer>
    </div>
  )
}
