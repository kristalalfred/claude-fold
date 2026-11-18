import type { Status } from '../types'

const CELL_WIDTH = 24
const CELL_HEIGHT = 48
const RADIUS = 16
const MARGIN = 1
const GAP = 3
const STEP_X = 12
const STEP_Y = 3
const FRONT_Y = 28
const DEPTH_ALPHA = [1, 0.7, 0.5, 0.36]
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

export const pixelsOf = (discs: readonly Status[]) => {
  const frontX = MARGIN + RADIUS + (discs.length - 1) * STEP_X
  const columns = Math.ceil((frontX + RADIUS + MARGIN) / CELL_WIDTH)
  const width = columns * CELL_WIDTH
  const pixels = new Uint8Array(width * CELL_HEIGHT * 4)

  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let [red, green, blue, alpha] = [0, 0, 0, 0]

      for (const [depth, status] of [...discs.entries()].reverse()) {
        const distance = Math.hypot(
          x + 0.5 - (frontX - depth * STEP_X),
          y + 0.5 - (FRONT_Y - depth * STEP_Y),
        )
        const disc = coverage(distance, RADIUS)
        const kept = (1 - coverage(distance, RADIUS + GAP)) * (1 - disc)
        const paint = (DEPTH_ALPHA[depth] ?? 0) * disc
        const [discRed, discGreen, discBlue] = RGB[status]
        red = red * kept + discRed * paint
        green = green * kept + discGreen * paint
        blue = blue * kept + discBlue * paint
        alpha = alpha * kept + paint
      }
      const scale = alpha === 0 ? 0 : 1 / alpha
      pixels.set(
        [red * scale, green * scale, blue * scale, alpha * 255].map(Math.round),
        (y * width + x) * 4,
      )
    }
  }

  return { pixels, width, height: CELL_HEIGHT, columns }
}

export const stackOf = (discs: readonly Status[]) => {
  const key = discs.join()
  const known = drawn.get(key)

  if (known !== undefined) {
    return known
  }
  const { pixels, ...box } = pixelsOf(discs)
  const stack = { rgba: base64Of(pixels), ...box }
  drawn.set(key, stack)

  return stack
}
