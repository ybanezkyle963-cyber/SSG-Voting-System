/**
 * Where a phone that scans the stub should land.
 *
 * A receipt is 32 characters of hexadecimal — asking a voter to type that from
 * a paper stub, on a phone, is asking for a mistyped code and a false alarm. So
 * the stub carries a QR symbol whose payload is the checker's own address with
 * the code already in the query string.
 *
 * The address is built from wherever this copy of the app is being served, so a
 * stub printed from the school's deployment points at the school's deployment,
 * and one printed from a laptop on the lab network points there. When the app
 * is opened straight from a file there is no address a phone could reach, so
 * this returns null and the caller falls back to encoding the bare code — which
 * still saves the typing, since a scan can copy it.
 */

export function receiptLink(receipt: string): string | null {
  if (typeof window === 'undefined') return null

  const { protocol, origin, pathname } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return null

  const code = receipt.trim()
  if (!code) return null

  // The path is whatever was served: `/`, `/index.html`, or a subdirectory.
  // A directory needs its trailing slash before the fragment, but a file must
  // not have one — `https://host/index.html/#/verify` makes the browser ask for
  // `/index.html/`, which static hosts tend to answer with a 404.
  const looksLikeFile = /\.[a-z0-9]+$/i.test(pathname)
  const base = pathname.endsWith('/') || looksLikeFile ? pathname : `${pathname}/`

  return `${origin}${base}#/verify?receipt=${encodeURIComponent(code)}`
}
