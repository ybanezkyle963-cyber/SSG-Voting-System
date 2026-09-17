/**
 * A QR Code encoder, written out rather than installed.
 *
 * Why not a library or a QR web service: this client's promise is that it runs
 * with no runtime dependencies, offline, straight from a folder. A web service
 * would mean the receipt code leaves the voter's machine over the network — a
 * receipt is designed to be safe to show, but it is still not the voter's
 * business to hand it to a third party. A library would mean a dependency in a
 * project whose whole argument is that you can read the source in one sitting.
 *
 * So: byte mode, error correction level L, versions 1 to 10 — up to 274 bytes,
 * more than a deployment URL plus a 32-character receipt code needs. The
 * procedure is ISO/IEC 18004. Everything tables-shaped is computed at runtime
 * from a handful of published constants, so there is no long array to mistype.
 *
 * Verified against the reference `qrcode` implementation (identical matrices,
 * mask for mask) and decoded back with an independent `jsqr` reader.
 */

/* ------------------------------------------------------------ Galois field */

/** exp/log tables for GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1. */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): Uint8Array {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

/** Remainder of `data` divided by `divisor` — the error-correction codewords. */
function rsRemainder(data: Uint8Array | number[], divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length)
  for (const b of data) {
    const factor = b ^ result[0]
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

/* --------------------------------------------------------------- version spec */

interface VersionSpec {
  version: number
  /** [block count, data codewords per block], one entry per group. */
  groups: [number, number][]
  ecPerBlock: number
}

/**
 * Error correction level L for versions 1-10. The data totals are the published
 * capacities (19, 34, 55, 80, 108, 136, 156, 194, 232, 274 bytes), which is a
 * useful check on the block split: 2 x 68 and 2 x 69 makes 274 for version 10.
 */
const SPECS: VersionSpec[] = [
  { version: 1, groups: [[1, 19]], ecPerBlock: 7 },
  { version: 2, groups: [[1, 34]], ecPerBlock: 10 },
  { version: 3, groups: [[1, 55]], ecPerBlock: 15 },
  { version: 4, groups: [[1, 80]], ecPerBlock: 20 },
  { version: 5, groups: [[1, 108]], ecPerBlock: 26 },
  { version: 6, groups: [[2, 68]], ecPerBlock: 18 },
  { version: 7, groups: [[2, 78]], ecPerBlock: 20 },
  { version: 8, groups: [[2, 97]], ecPerBlock: 24 },
  { version: 9, groups: [[2, 116]], ecPerBlock: 30 },
  { version: 10, groups: [[2, 68], [2, 69]], ecPerBlock: 18 }
]

const dataCodewords = (spec: VersionSpec) =>
  spec.groups.reduce((total, [count, per]) => total + count * per, 0)

/** EC level L is `01` in the format information. */
const EC_LEVEL_BITS = 1

const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0

/** 15-bit format information: 5 data bits, 10 BCH bits, XOR mask 0x5412. */
function formatBits(mask: number): number {
  const data = (EC_LEVEL_BITS << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** 18-bit version information, for versions 7 and up. */
function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

/** Centers of the alignment patterns, derived from the version. */
function alignmentCenters(version: number, size: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2
  const result = new Array<number>(count).fill(0)
  result[0] = 6
  for (let i = count - 1, pos = size - 7; i >= 1; i--, pos -= step) result[i] = pos
  return result
}

/* ----------------------------------------------------------- data codewords */

/** Mode indicator, character count, payload, terminator and pad codewords. */
function encodeDataCodewords(payload: Uint8Array, spec: VersionSpec): number[] {
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }

  push(0b0100, 4) // byte mode
  push(payload.length, spec.version < 10 ? 8 : 16)
  for (const byte of payload) push(byte, 8)

  const capacityBits = dataCodewords(spec) * 8
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }

  const PAD = [0xec, 0x11]
  let k = 0
  while (codewords.length < capacityBits / 8) codewords.push(PAD[k++ % 2])
  return codewords
}

/** Splits into blocks, appends EC codewords, and interleaves as the spec requires. */
function interleaveWithEc(data: number[], spec: VersionSpec): number[] {
  const divisor = generatorPoly(spec.ecPerBlock)
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []

  let offset = 0
  for (const [count, per] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + per)
      offset += per
      dataBlocks.push(block)
      ecBlocks.push([...rsRemainder(block, divisor)])
    }
  }

  const out: number[] = []
  const longestBlock = Math.max(...dataBlocks.map((b) => b.length))
  for (let i = 0; i < longestBlock; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i])
  }
  return out
}

/* ---------------------------------------------------------------- the matrix */

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

interface Matrix {
  size: number
  modules: boolean[][]
}

/** A mask candidate and the penalty it scored — lower is better. */
interface ScoredMatrix extends Matrix {
  score: number
}

function buildMatrix(spec: VersionSpec, codewords: number[], mask: number): Matrix {
  const size = spec.version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))

  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    isFunction[y][x] = true
  }

  // Timing patterns first: the finder patterns below overwrite the parts of
  // row and column 6 that fall inside them, which is what the spec expects.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, dist !== 2 && dist !== 4) // rings at 3 and 0-1 dark, 2 and separator light
      }
    }
  }
  drawFinder(3, 3)
  drawFinder(size - 4, 3)
  drawFinder(3, size - 4)

  const centers = alignmentCenters(spec.version, size)
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)
      if (corner) continue // the finder patterns already own those corners
      const cx = centers[i]
      const cy = centers[j]
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  const bits = formatBits(mask)
  for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i))
  set(8, 7, getBit(bits, 6))
  set(8, 8, getBit(bits, 7))
  set(7, 8, getBit(bits, 8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i))
  set(8, size - 8, true) // the always-dark module

  if (spec.version >= 7) {
    const vb = versionBits(spec.version)
    for (let i = 0; i < 18; i++) {
      const bit = getBit(vb, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  // Data, in the two-module-wide zigzag the spec defines.
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // skip the vertical timing pattern
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (isFunction[y][x]) continue
        // Remaining bits (the spec's remainder bits) stay light.
        modules[y][x] = index < codewords.length * 8 && getBit(codewords[index >>> 3], 7 - (index & 7))
        index++
      }
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && maskApplies(mask, x, y)) modules[y][x] = !modules[y][x]
    }
  }

  return { size, modules }
}

/* ------------------------------------------------------------ mask selection */

const N1 = 3
const N2 = 3
const N3 = 40
const N4 = 10

/**
 * Penalty score from the spec's four rules. Only used to pick between masks —
 * every mask produces a valid symbol, so this is about scanability, not
 * correctness.
 */
function penalty(matrix: Matrix): number {
  const { size, modules } = matrix
  let score = 0

  const scanLine = (get: (i: number) => boolean) => {
    let runColor = false
    let runLength = 0
    const history = [0, 0, 0, 0, 0, 0, 0]
    const addHistory = (length: number) => {
      let value = length
      if (history[0] === 0) value += size // pretend a light border precedes the line
      history.copyWithin(1, 0, 6)
      history[0] = value
    }
    const countPatterns = () => {
      const n = history[1]
      const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
      return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    }

    for (let i = 0; i < size; i++) {
      const color = get(i)
      if (color === runColor) {
        runLength++
        if (runLength === 5) score += N1
        else if (runLength > 5) score++
      } else {
        addHistory(runLength)
        if (!runColor) score += countPatterns() * N3
        runColor = color
        runLength = 1
      }
    }
    if (runColor) {
      addHistory(runLength)
      runLength = 0
    }
    addHistory(runLength + size)
    score += countPatterns() * N3
  }

  for (let y = 0; y < size; y++) scanLine((x) => modules[y][x])
  for (let x = 0; x < size; x++) scanLine((y) => modules[y][x])

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x]
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += N2
    }
  }

  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  const total = size * size
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * N4

  return score
}

/* ----------------------------------------------------------------- public API */

export interface QrResult {
  version: number
  mask: number
  size: number
  /** true = dark module, indexed [row][column]. */
  modules: boolean[][]
}

/**
 * Encodes `text` as a QR symbol. Throws if it does not fit in version 10 —
 * pass an explicit `mask` to compare against a reference implementation.
 */
export function encodeQr(text: string, options: { mask?: number } = {}): QrResult {
  const payload = new TextEncoder().encode(text)

  const spec = SPECS.find((candidate) => {
    const overhead = 4 + (candidate.version < 10 ? 8 : 16)
    return 8 * payload.length + overhead <= dataCodewords(candidate) * 8
  })
  if (!spec) throw new Error(`Too long for a QR symbol: ${payload.length} bytes.`)

  const codewords = interleaveWithEc(encodeDataCodewords(payload, spec), spec)

  let best: ScoredMatrix | null = null
  let bestMask = 0
  const candidates = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask]
  for (const mask of candidates) {
    const matrix = buildMatrix(spec, codewords, mask)
    // With one mask forced there is nothing to choose between, so skip the
    // scoring pass — it changes no output and costs a scan of the whole symbol.
    const score = candidates.length === 1 ? 0 : penalty(matrix)
    if (best === null || score < best.score) {
      best = { ...matrix, score }
      bestMask = mask
    }
  }

  const matrix = best as ScoredMatrix
  return { version: spec.version, mask: bestMask, size: matrix.size, modules: matrix.modules }
}

/**
 * One `<path>` covering the dark modules, drawn as horizontal runs so the
 * output stays small. Add a quiet zone when placing it.
 */
export function qrSvgPath(modules: boolean[][], quietZone = 4): string {
  const size = modules.length
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (!modules[y][x]) {
        x++
        continue
      }
      let run = 0
      while (x + run < size && modules[y][x + run]) run++
      parts.push(`M${x + quietZone} ${y + quietZone}h${run}v1h-${run}z`)
      x += run
    }
  }
  return parts.join('')
}
