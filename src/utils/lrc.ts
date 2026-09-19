export interface LrcLine { timeMs: number; text: string }

const STAMP = /\[(\d{1,3})(?::(\d{1,2}))?(?:[.:](\d{1,3}))?]/g

function fracMs(raw: string): number {
  if (!raw) return 0
  if (raw.length === 1) return Number(raw) * 100
  if (raw.length === 2) return Number(raw) * 10
  return Number(raw.slice(0, 3))
}

/** 兼容标准 [mm:ss.xx] 与酷我的 [ss.xx] 秒制时间戳 */
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(STAMP)]
    if (!stamps.length) continue
    const text = raw.slice(stamps[stamps.length - 1].index! + stamps[stamps.length - 1][0].length).trim()
    for (const m of stamps) {
      const [, g1, g2, g3] = m
      const timeMs = g2 === undefined
        ? Number(g1) * 1000 + fracMs(g3 ?? '')
        : Number(g1) * 60000 + Number(g2) * 1000 + fracMs(g3 ?? '')
      out.push({ timeMs, text })
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs)
}

export function currentIndex(lines: LrcLine[], positionSec: number): number {
  const pos = positionSec * 1000 + 300
  let idx = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].timeMs <= pos) idx = i
  return idx
}
