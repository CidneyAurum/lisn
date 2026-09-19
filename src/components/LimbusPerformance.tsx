import { useEffect, useRef } from 'react'
import type { LrcLine } from '../utils/lrc'

/**
 * Limbus 歌词演出模式(Canvas)
 * 移植自 LimbusLyricSimulator 演出方案:逐字显现 + 字符抖动 + 旧行淡出上升
 * 配色:奶白 #fffeef / 金描边 #d8a523(Limbus 标志性)
 * 与 LRC 时间轴同步:按行时长插值逐字显现;暂停时因 position 冻结而自然停格
 */

interface FadingLine {
  chars: string[]
  alpha: number
  y: number
  angle: number
}

// 伴奏/职员表过滤(思路来自 LLS 的 lyric_config 正则)
const FILTER_RE = /(作词|作曲|编曲|混音|和声|监制|吉他|贝斯|键盘|鼓|Inst\b|instrumental)/i

const TEXT_COLOR = '#fffeef'
const STROKE_COLOR = '#d8a523'

interface Props {
  lines: LrcLine[]
  getPositionSec: () => number
  onSeek?: (ms: number) => void
}

export function LimbusPerformance({ lines, getPositionSec, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ lines, getPositionSec, onSeek })
  propsRef.current = { lines, getPositionSec, onSeek }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let stopped = false

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (rect) {
        canvas.width = Math.max(320, Math.floor(rect.width))
        canvas.height = Math.max(240, Math.floor(rect.height))
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    // 演出状态
    const fading: FadingLine[] = []
    let lastLineIdx = -1
    let shakeSeed: number[] = []

    const setFont = (px: number) => {
      ctx.font = `bold ${px}px "Microsoft YaHei", "PingFang SC", sans-serif`
    }

    const render = () => {
      if (stopped) return
      const { lines: lrcLines, getPositionSec } = propsRef.current
      const W = canvas.width
      const H = canvas.height
      const now = performance.now()
      const posMs = getPositionSec() * 1000

      ctx.clearRect(0, 0, W, H)

      // 定位当前行
      let cur = -1
      for (let i = 0; i < lrcLines.length; i++) {
        if (lrcLines[i].timeMs <= posMs) cur = i
        else break
      }

      let line: LrcLine | null = null
      let lineDur = 4000
      if (cur >= 0) {
        const cand = lrcLines[cur]
        if (!FILTER_RE.test(cand.text)) {
          line = cand
          lineDur = Math.max(1500, (lrcLines[cur + 1]?.timeMs ?? posMs + 4000) - cand.timeMs)
        }
      }

      // 行切换:旧行推入淡出数组,重置抖动种子
      if (line && cur !== lastLineIdx) {
        const prevText = lastLineIdx >= 0 && lastLineIdx < lrcLines.length ? lrcLines[lastLineIdx].text : null
        if (prevText && !FILTER_RE.test(prevText)) {
          fading.push({
            chars: Array.from(prevText),
            alpha: 1,
            y: H * 0.42,
            angle: (Math.random() * 16 - 8) * Math.PI / 180,
          })
          if (fading.length > 4) fading.shift()
        }
        const chars = Array.from(line.text)
        shakeSeed = chars.map(() => Math.random() * Math.PI * 2)
        lastLineIdx = cur
      }

      // ---- 淡出的旧行(上升 + 淡出,微透视斜排) ----
      for (let fi = fading.length - 1; fi >= 0; fi--) {
        const f = fading[fi]
        f.alpha -= 0.012
        f.y -= 0.9
        if (f.alpha <= 0) { fading.splice(fi, 1); continue }
        const fontPx = Math.min(40, Math.max(24, W / 30))
        setFont(fontPx)
        ctx.textBaseline = 'alphabetic'
        let x = (W - ctx.measureText(f.chars.join('')).width) / 2
        for (let i = 0; i < f.chars.length; i++) {
          const ch = f.chars[i]
          const cw = ctx.measureText(ch).width + 3
          const rad = f.angle
          const ox = i * cw * Math.cos(rad)
          const oy = i * cw * Math.sin(rad)
          ctx.save()
          ctx.globalAlpha = Math.max(0, f.alpha)
          ctx.fillStyle = STROKE_COLOR
          ctx.fillText(ch, x + ox + 2, f.y + oy + 2)
          ctx.fillStyle = TEXT_COLOR
          ctx.globalAlpha = Math.max(0, f.alpha * 0.95)
          ctx.fillText(ch, x + ox, f.y + oy)
          ctx.restore()
          x += cw
        }
      }

      // ---- 当前行(逐字显现 + 抖动) ----
      if (line) {
        const chars = Array.from(line.text)
        const shown = Math.min(
          chars.length,
          Math.ceil(((posMs - line.timeMs) / lineDur) * chars.length * 1.4)
        )
        const fontPx = Math.min(44, Math.max(26, W / 26))
        setFont(fontPx)
        ctx.textBaseline = 'alphabetic'
        const widths = chars.map(ch => ctx.measureText(ch).width + 4)
        const totalW = widths.reduce((a, b) => a + b, 0)
        let x = (W - totalW) / 2
        const y = H * 0.5

        for (let i = 0; i < chars.length; i++) {
          const cw = widths[i]
          const jx = Math.sin(now / 90 + shakeSeed[i] * 7) * 2.2
          const jy = Math.cos(now / 110 + shakeSeed[i] * 11) * 1.6
          if (i < shown) {
            ctx.save()
            ctx.globalAlpha = 0.85
            ctx.fillStyle = STROKE_COLOR
            ctx.fillText(chars[i], x + jx + 2.5, y + jy + 2.5)
            ctx.fillStyle = '#0d0d0d'
            ctx.globalAlpha = 0.6
            ctx.fillText(chars[i], x + jx + 1.2, y + jy + 1.2)
            ctx.fillStyle = TEXT_COLOR
            ctx.globalAlpha = 1
            ctx.fillText(chars[i], x + jx, y + jy)
            ctx.restore()
          } else {
            ctx.save()
            ctx.globalAlpha = 0.12
            ctx.fillStyle = TEXT_COLOR
            ctx.fillText(chars[i], x, y)
            ctx.restore()
          }
          x += cw
        }
      }

      raf = requestAnimationFrame(render)
    }

    raf = requestAnimationFrame(render)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // 点击左/右半区 = 上一行/下一行起点
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { lines, getPositionSec, onSeek } = propsRef.current
    if (!onSeek || !lines.length) return
    const posMs = getPositionSec() * 1000
    let cur = -1
    for (let i = 0; i < lines.length; i++) if (lines[i].timeMs <= posMs) cur = i
    const rect = e.currentTarget.getBoundingClientRect()
    const next = e.clientX - rect.left < rect.width / 2 ? cur - 1 : cur + 1
    const target = lines[Math.max(0, Math.min(lines.length - 1, next))]
    if (target) onSeek(target.timeMs)
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ width: '100%', height: '100%', cursor: 'pointer', display: 'block' }}
    />
  )
}
