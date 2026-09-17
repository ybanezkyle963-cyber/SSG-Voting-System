export function when(iso: string | undefined | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function shortHash(hash: string | undefined, length = 12): string {
  if (!hash) return '—'
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`
}

/** Turns `ballot.sealed` into `Ballot — sealed` for display in the audit table. */
export function eventLabel(event: string): string {
  const [area, action] = event.split('.')
  const title = area.replace(/-/g, ' ')
  return `${title.charAt(0).toUpperCase()}${title.slice(1)} — ${action ?? ''}`.replace(/ — $/, '')
}

/** "1 ballot sealed", "5 ballots sealed" — the reconciliation alarm reads by eye. */
export function plural(count: number, one: string, many?: string): string {
  return `${count} ${count === 1 ? one : (many ?? `${one}s`)}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
