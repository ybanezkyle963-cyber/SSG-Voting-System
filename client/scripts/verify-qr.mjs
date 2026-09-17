/**
 * Verifies the hand-written QR encoder and the receipt link builder.
 *
 * The encoder in `src/lib/qr.ts` is written out rather than installed, which is
 * only defensible if it is actually correct. This checks it four ways:
 *
 *   1. every module matches the reference `qrcode` implementation, mask for
 *      mask, so the data codewords, Reed-Solomon blocks, interleaving,
 *      placement and format/version bits are all right;
 *   2. version selection agrees with the reference, which is a check on the
 *      block-split table;
 *   3. an independent reader (`jsqr`) decodes the symbol back to the input —
 *      the only test that matches what a phone does;
 *   4. `qrSvgPath` reproduces the matrix exactly when parsed back, so the
 *      symbol drawn on screen and on paper is the symbol that was encoded.
 *
 * Run with `npm run verify:qr`.
 */
import { encodeQr, qrSvgPath } from '../src/lib/qr.ts'
import { receiptLink } from '../src/lib/verifyLink.ts'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const RECEIPT = 'e7fce560f5eeeafb8c81d087bb836134'
const QUIET = 4

const PAYLOADS = [
  ['short text', 'hello'],
  ['receipt code', RECEIPT],
  ['deployment URL', `https://ssg-voting-system.vercel.app/#/verify?receipt=${RECEIPT}`],
  ['localhost URL', `http://localhost:5173/#/verify?receipt=${RECEIPT}`],
  ['long school URL', `https://ssg.election.example.edu.ph/2026/#/verify?receipt=${RECEIPT}`],
  ['17 bytes (v1 limit)', 'a'.repeat(17)],
  ['18 bytes (forces v2)', 'b'.repeat(18)],
  ['150 bytes', 'x'.repeat(150)],
  ['260 bytes (v10)', 'y'.repeat(260)]
]

/*
 * The reference library splits runs of digits into numeric-mode segments by
 * default, which produces a smaller but different symbol. Pinning it to byte
 * mode is what makes the comparison a test of this encoder rather than a
 * comparison of two valid encodings.
 */
const reference = (text, options = {}) =>
  QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'L', ...options })

const referenceMatrix = (text, version, mask) => {
  const { modules } = reference(text, { version, maskPattern: mask })
  const { size, data } = modules
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => data[y * size + x] === 1)
  )
}

/** Rasterises a matrix and reads it with jsqr, the way a scanner would. */
function decode(modules) {
  const size = modules.length
  const scale = 8
  const dim = (size + QUIET * 2) * scale
  const pixels = new Uint8ClampedArray(dim * dim * 4).fill(255)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x]) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + QUIET) * scale + dy) * dim + (x + QUIET) * scale + dx) * 4
          pixels[i] = 0
          pixels[i + 1] = 0
          pixels[i + 2] = 0
          pixels[i + 3] = 255
        }
      }
    }
  }

  return jsQR(pixels, dim, dim, { inversionAttempts: 'dontInvert' })
}

/** Parses an SVG path from `qrSvgPath` back into a matrix. */
function parsePath(d, size) {
  const grid = Array.from({ length: size }, () => new Uint8Array(size))
  const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g
  let match
  while ((match = re.exec(d))) {
    const x = Number(match[1]) - QUIET
    const y = Number(match[2]) - QUIET
    const run = Number(match[3])
    if (y < 0 || y >= size || x < 0 || x + run > size) throw new Error(`run out of bounds at (${x},${y})`)
    for (let i = 0; i < run; i++) grid[y][x + i] = 1
  }
  return grid
}

let failures = 0
const report = (ok, message) => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
}

console.log('1. every module matches the reference encoder (8 masks each)')
for (const [label, text] of PAYLOADS) {
  const mine = encodeQr(text)
  const problems = []

  for (let mask = 0; mask < 8; mask++) {
    const candidate = encodeQr(text, { mask })
    const theirs = referenceMatrix(text, candidate.version, mask)
    let differing = 0
    for (let y = 0; y < candidate.size; y++) {
      for (let x = 0; x < candidate.size; x++) {
        if (candidate.modules[y][x] !== theirs[y][x]) differing++
      }
    }
    if (differing) problems.push(`mask ${mask}: ${differing} modules differ`)
  }

  report(
    problems.length === 0,
    `${label.padEnd(20)} v${String(mine.version).padStart(2)} ${mine.size}x${mine.size} mask ${mine.mask} — ${
      problems.length ? problems.join('; ') : '8/8 identical'
    }`
  )
}

console.log('\n2. version selection agrees with the reference')
for (const [label, text] of PAYLOADS) {
  const mine = encodeQr(text).version
  const theirs = reference(text).version
  report(mine === theirs, `${label.padEnd(20)} ${String(text.length).padStart(3)} bytes -> v${mine}`)
}

console.log('\n3. an independent reader decodes the symbol')
for (const [label, text] of PAYLOADS) {
  const result = decode(encodeQr(text).modules)
  report(result?.data === text, `${label.padEnd(20)} ${result ? 'decoded to the input' : 'did not decode'}`)
}

console.log('\n4. the drawn SVG path reproduces the matrix exactly')
for (const [label, text] of PAYLOADS) {
  const symbol = encodeQr(text)
  const grid = parsePath(qrSvgPath(symbol.modules, QUIET), symbol.size)
  let differing = 0
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      if (symbol.modules[y][x] !== (grid[y][x] === 1)) differing++
    }
  }
  const roundTrip = decode(grid)
  report(
    differing === 0 && roundTrip?.data === text,
    `${label.padEnd(20)} ${differing} differing modules, path decodes to ${roundTrip?.data === text ? 'the input' : 'nothing'}`
  )
}

console.log('\n5. the symbol is refused rather than truncated when too long')
try {
  encodeQr('z'.repeat(275))
  report(false, '275 bytes should not fit in version 10')
} catch (error) {
  report(true, `275 bytes rejected: ${error.message}`)
}

console.log('\n6. where a scan sends the voter')
const suffix = `#/verify?receipt=${RECEIPT}`
// Expectations are written out rather than recomputed, so this checks the
// behaviour a phone will follow: one slash at the root, a trailing slash for a
// directory, and never a slash after a file name.
const linkCases = [
  ['dev server root', 'http://localhost:5173/', '/', `http://localhost:5173/${suffix}`],
  ['deployed root', 'https://ssg-voting-system.vercel.app/', '/', `https://ssg-voting-system.vercel.app/${suffix}`],
  ['subdirectory', 'https://example.edu.ph/ssg/election', '/ssg/election', `https://example.edu.ph/ssg/election/${suffix}`],
  ['subdirectory + slash', 'https://example.edu.ph/ssg/election/', '/ssg/election/', `https://example.edu.ph/ssg/election/${suffix}`],
  ['explicit index.html', 'https://example.edu.ph/index.html', '/index.html', `https://example.edu.ph/index.html${suffix}`]
]
for (const [label, href, pathname, expected] of linkCases) {
  globalThis.window = { location: { protocol: new URL(href).protocol, origin: new URL(href).origin, pathname } }
  const link = receiptLink(RECEIPT)
  report(link === expected, `${label.padEnd(20)} ${link}`)
}

// Opened from a file there is no address a phone could reach, so the symbol
// carries the bare code instead — still worth scanning, to copy the 32 chars.
globalThis.window = {
  location: { protocol: 'file:', origin: 'null', pathname: '/C:/election/index.html' }
}
report(receiptLink(RECEIPT) === null, 'opened from a file    falls back to encoding the bare code')

globalThis.window = { location: { protocol: 'https:', origin: 'https://x.test', pathname: '/' } }
report(receiptLink('   ') === null, 'blank receipt         returns null rather than a useless link')

console.log(`\n${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
