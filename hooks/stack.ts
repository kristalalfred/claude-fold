import type { Status } from '../types'

const CELL_WIDTH = 24
const CELL_HEIGHT = 48
const RADIUS = 10
const GAP = 2
const STEP = 8
const DEPTH_ALPHA = [1, 0.6, 0.42, 0.3]
const RGB: Record<Status, readonly [number, number, number]> = {
  running: [153, 153, 153],
  done: [78, 186, 101],
  failed: [255, 107, 128],
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

type Stack = { rgba: string; width: number; height: number; columns: number }

const drawn = new Map<string, Stack>()

const base64Of = (bytes: Uint8Array) => {
  let text = ''

  for (let at = 0; at < bytes.length; at += 3) {
    const [first = 0, second = 0, third = 0] = bytes.subarray(at, at + 3)
    const bits = (first << 16) | (second << 8) | third
    const sextets = [18, 12, 6, 0].map(shift => BASE64[(bits >> shift) & 63])
    text += sextets
      .map((sextet, place) => (at + place > bytes.length ? '=' : sextet))
      .join('')
  }

  return text
}

const coverage = (distance: number, radius: number) =>
  Math.min(1, Math.max(0, radius + 0.5 - distance))

export const pixelsOf = (discs: number, status: Status) => {
  const columns = discs === 1 ? 1 : 2
  const width = columns * CELL_WIDTH
  const frontX = width - CELL_WIDTH / 2
  const centerY = CELL_HEIGHT / 2
  const pixels = new Uint8Array(width * CELL_HEIGHT * 4)
  const [red, green, blue] = RGB[status]

  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let alpha = 0

      for (let depth = discs - 1; depth >= 0; depth -= 1) {
        const distance = Math.hypot(
          x + 0.5 - (frontX - depth * STEP),
          y + 0.5 - centerY,
        )
        const disc = coverage(distance, RADIUS)
        alpha *= 1 - coverage(distance, RADIUS + GAP)
        alpha = alpha * (1 - disc) + (DEPTH_ALPHA[depth] ?? 0) * disc
      }
      pixels.set([red, green, blue, Math.round(alpha * 255)], (y * width + x) * 4)
    }
  }

  return { pixels, width, height: CELL_HEIGHT, columns }
}

export const stackOf = (discs: number, status: Status) => {
  const key = `${discs}:${status}`
  const known = drawn.get(key)

  if (known !== undefined) {
    return known
  }
  const { pixels, ...box } = pixelsOf(discs, status)
  const stack = { rgba: base64Of(pixels), ...box }
  drawn.set(key, stack)

  return stack
}
