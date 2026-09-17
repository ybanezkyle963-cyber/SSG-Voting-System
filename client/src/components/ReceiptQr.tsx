import { useMemo } from 'react'
import { encodeQr, qrSvgPath } from '../lib/qr'
import { receiptLink } from '../lib/verifyLink'

/** Spec's minimum quiet zone, in modules. Carried inside the SVG's viewBox. */
const QUIET = 4

interface ReceiptQrProps {
  receipt: string
  /**
   * Drawn width and height, in CSS pixels. The default is sized for the sheet
   * of paper rather than the screen: this symbol is 33 modules across, so a
   * 148px box prints roughly 4cm wide, which is comfortably scannable.
   */
  size?: number
}

/**
 * The scannable half of the stub.
 *
 * Deliberately prints: the stub is the artifact a voter keeps, and a QR code
 * that vanishes when the stub is printed would be useless. Black on white, no
 * background image, no transparency, so it survives a cheap printer and a
 * photocopier. If encoding fails for any reason the component renders nothing
 * rather than breaking the page — the typed receipt code is still on the stub
 * above it, and the count does not depend on this.
 */
export function ReceiptQr({ receipt, size = 148 }: ReceiptQrProps) {
  const link = receiptLink(receipt)
  const payload = link ?? receipt

  const symbol = useMemo(() => {
    try {
      return encodeQr(payload)
    } catch {
      return null
    }
  }, [payload])

  if (!symbol) return null

  const box = symbol.size + QUIET * 2

  return (
    <figure className="flex items-center gap-4">
      <svg
        role="img"
        aria-label={
          link
            ? `QR code that opens the receipt checker for receipt ${receipt}`
            : `QR code containing the receipt code ${receipt}`
        }
        viewBox={`0 0 ${box} ${box}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className="shrink-0 bg-white"
      >
        <path d={qrSvgPath(symbol.modules, QUIET)} fill="#000" />
      </svg>

      <figcaption className="max-w-[19rem] font-sans text-xs leading-relaxed text-ink-60">
        {link ? (
          <>
            <strong className="block text-ink">Scan this with a phone camera</strong>
            It opens the receipt checker with your code already filled in — no need to type the 32
            characters.
          </>
        ) : (
          <>
            <strong className="block text-ink">Scan this to copy the code</strong>
            This copy of the app was opened from a file, so a phone cannot reach it directly. The
            scan still gives you the code to paste.
          </>
        )}
      </figcaption>
    </figure>
  )
}
