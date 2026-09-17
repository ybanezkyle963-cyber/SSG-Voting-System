/**
 * A tiny hash router.
 *
 * Hash routes work when the built site is opened straight from disk or served
 * from any static path, which is how a school would actually deploy this. No
 * dependency, no server rewrite rules.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface Route {
  path: string
  query: URLSearchParams
}

function readHash(): Route {
  const raw = window.location.hash.replace(/^#/, '')
  const [pathPart, queryPart] = raw.split('?')
  const trimmed = (pathPart || '/').replace(/\/+$/, '')
  return {
    path: trimmed.startsWith('/') ? trimmed || '/' : `/${trimmed}`,
    query: new URLSearchParams(queryPart ?? '')
  }
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`
  if (window.location.hash === target) return
  if (options.replace) {
    window.history.replaceState(null, '', target)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = target
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readHash)

  useEffect(() => {
    const onChange = () => setRoute(readHash())
    window.addEventListener('hashchange', onChange)
    if (!window.location.hash) navigate('/', { replace: true })
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

interface LinkProps {
  to: string
  children: ReactNode
  className?: string
  title?: string
  onClick?: () => void
}

/** A real anchor, so middle-click and keyboard activation behave normally. */
export function Link({ to, children, className, title, onClick }: LinkProps) {
  return (
    <a
      href={`#${to}`}
      className={className}
      title={title}
      onClick={() => {
        onClick?.()
      }}
    >
      {children}
    </a>
  )
}
