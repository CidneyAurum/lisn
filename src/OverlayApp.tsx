import { useEffect, useRef, useState } from 'react'

/**
 * 桌面歌词悬浮窗(独立置顶窗口)
 * 渲染忠实移植 LimbusLyricSimulator:
 *  - LRC 时间轴驱动,逐字显现(50ms/字)
 *  - 中文(阴影式)/英文(描边式)按句自动判定
 *  - 辉光/阴影、字符抖动、完成后淡出上升
 *  - 职员表/伴奏行过滤(正则对齐上游 DEFAULT_CREDIT/INST_PATTERNS)
 *  - 字体:Mikodacs(拉丁)+ 思源黑体 Bold(CJK),原版资源
 * 数据:主窗口经主进程推送 overlay:lyrics / overlay:pos(60ms)
 * 交互:顶部把手拖动;锁定后整窗点击穿透
 */

interface LrcLine { timeMs: number; text: string }

declare global {
  interface Window {
    overlayBridge: {
      onLyrics(cb: (data: PushedLyrics) => void): () => void
      onPos(cb: (sec: number) => void): () => void
      onConfig(cb: (cfg: unknown) => void): () => void
    }
    overlayControls: {
      ready(): void
      setLocked(v: boolean): void
    }
  }
}

interface PushedLyrics {
  lines: { timeMs: number; text: string }[]
  title: string
  artist: string
}

const CREDIT_PATTERNS = [
  /作词/, /作曲/, /编曲/, /制作人/, /OP[：:]/, /SP[：:]/, /原唱/, /翻唱/, /混音/, /录音/,
  /和声/, /监制/, /统筹/, /企划/, /出品/, /封面/, /曲\s*[：:]/, /词\s*[：:]/,
  /吉他\s*[：:]/, /贝斯\s*[：:]/, /鼓\s*[：:]/, /键盘\s*[：:]/, /弦乐\s*[：:]/,
  /program(ming)?\s*[：:]/i, /produced\s+by/i, /written\s+by/i, /composed\s+by/i, /arranged\s+by/i, /mixed\s+by/i, /mastered\s+by/i,
]
const INST_PATTERNS = [
  /\(inst\.?\)/i, /（inst\.?）/i, /\[inst\.?\]/i, /【inst\.?】/i, /\binst\.?$/i,
  /instrumental/i, /纯音乐/, /伴奏/, /off\s*vocal/i, /offvocal/i, /カラオケ/i, /karaoke/i,
]
const isCreditLine = (t: string) => CREDIT_PATTERNS.some(re => re.test(t))
const isInstLine = (t: string) => INST_PATTERNS.some(re => re.test(t))

const TEXT_COLOR = '#fffeef'
const STROKE_COLOR = '#d8a523'

function detectLineMode(text: string): 'chinese' | 'english' | null {
  let hasCjk = false, hasLatin = false
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    const o = ch.codePointAt(0)!
    if ((o >= 0x2e80 && o <= 0x9fff) || (o >= 0xac00 && o <= 0xd7af) || (o >= 0xf900 && o <= 0xfaff)) hasCjk = true
    else if (/[a-zA-Z]/.test(ch)) hasLatin = true
  }
  if (hasCjk) return 'chinese'
  return hasLatin ? 'english' : null
}

interface FadingLine {
  parts: string[]
  alpha: number
  y: number
  angle: number
  mode: 'chinese' | 'english'
}

export function OverlayApp(): JSX.Element {
  const [lyrics, setLyrics] = useState<PushedLyrics | null>(null)
  const [posSec, setPosSec] = useState(0)
  const [cfg, setCfg] = useState({ color: '#fffeef', stroke: '#d8a523', fontSize: 42, glow: true })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ lyrics, posSec })
  stateRef.current = { lyrics, posSec }

  useEffect(() => {
    const bridge = window.overlayBridge
    if (!bridge) return
    bridge.onLyrics((data: PushedLyrics) => setLyrics(data))
    bridge.onPos((sec: number) => setPosSec(sec))
    window.overlayBridge?.onConfig?.((cfg: any) => setCfg(cfg))
    window.overlayControls?.ready()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let stopped = false
    Promise.all([
      document.fonts.load('700 34px Mikodacs'),
      document.fonts.load('700 34px "Source Han Sans SC"'),
    ]).catch(() => {})

    const resize = () => {
      canvas.width = Math.max(300, canvas.parentElement?.clientWidth ?? 640)
      canvas.height = Math.max(120, canvas.parentElement?.clientHeight ?? 180)
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    const fading: FadingLine[] = []
    let shakeSeed: number[] = []
    let lastLineIdx = -1
    let charTimer = 0
    let shakeTimer = 0
    let fadeTimer = 0
    const state = {
      spacing: 4,
      angleMin: -8, angleMax: 8,
      shakeIntensity: 2, shakeSpeed: 90,
      fadeSpeed: 0.014, riseSpeed: 0.9,
      strokeColor: cfg.stroke, textColor: cfg.color,
      fontSize: cfg.fontSize, glow: cfg.glow,
    }

    const isCjk = (ch: string) => {
      const o = ch.codePointAt(0)!
      return (o >= 0x2e80 && o <= 0x9fff) || (o >= 0xac00 && o <= 0xd7af) || (o >= 0xf900 && o <= 0xfaff)
    }

    const render = () => {
      if (stopped) return
      const W = canvas.width
      const H = canvas.height
      const now = performance.now()
      const posMs = stateRef.current.posSec * 1000
      const lines = stateRef.current.lyrics?.lines ?? []
      ctx.clearRect(0, 0, W, H)

      let cur = -1
      for (let i = 0; i < lines.length; i++) if (lines[i].timeMs <= posMs) cur = i
      let line: { timeMs: number; text: string } | null = cur >= 0 ? lines[cur] : null
      if (line && (isCreditLine(line.text) || isInstLine(line.text))) line = null

      if (line && cur !== lastLineIdx) {
        const prevText = lastLineIdx >= 0 && lastLineIdx < lines.length ? lines[lastLineIdx].text : null
        if (prevText) {
          fading.push({
            parts: Array.from(prevText),
            alpha: 1, y: H * 0.34,
            angle: (Math.random() * (state.angleMax - state.angleMin) + state.angleMin) * Math.PI / 180,
            mode: detectLineMode(prevText) ?? 'chinese',
          })
          if (fading.length > 3) fading.shift()
        }
        shakeSeed = Array.from(line.text).map(() => Math.random() * Math.PI * 2)
        lastLineIdx = cur
      }

      if (now - charTimer > 50) charTimer = now

      if (line) {
        const chars = Array.from(line.text)
        const shown = Math.min(chars.length, Math.floor((posMs - line.timeMs) / 42) + 1)
        const mode = detectLineMode(line.text) ?? 'chinese'
        const fontPx = Math.min(state.fontSize, Math.max(18, W / 22))
        ctx.font = '700 ' + fontPx + 'px "Source Han Sans SC", Mikodacs, "Microsoft YaHei"'
        ctx.textBaseline = 'alphabetic'
        const widths = chars.map(ch => ctx.measureText(ch).width + state.spacing)
        const totalW = widths.reduce((a, b) => a + b, 0)
        let x = (W - totalW) / 2
        const y = H * 0.58
        for (let i = 0; i < chars.length; i++) {
          const cw = widths[i]
          const jx = Math.sin(now / state.shakeSpeed + (shakeSeed[i] ?? 0) * 7) * state.shakeIntensity
          const jy = Math.cos(now / (state.shakeSpeed * 1.4) + (shakeSeed[i] ?? 0) * 11) * state.shakeIntensity * 0.7
          if (i < shown) {
            ctx.save()
            if (mode === 'english') {
              ctx.strokeStyle = state.strokeColor
              ctx.lineWidth = 2
              ctx.strokeText(chars[i], x + jx, y + jy)
              ctx.fillStyle = state.textColor
              ctx.fillText(chars[i], x + jx, y + jy)
            } else {
              ctx.fillStyle = state.strokeColor
              ctx.fillText(chars[i], x + jx + 2.5, y + jy + 2.5)
              ctx.fillStyle = '#0d0d0d'
              ctx.globalAlpha = 0.55
              ctx.fillText(chars[i], x + jx + 1, y + jy + 1)
              ctx.fillStyle = state.textColor
              ctx.globalAlpha = 1
              ctx.fillText(chars[i], x + jx, y + jy)
            }
            ctx.restore()
          } else {
            ctx.save()
            ctx.globalAlpha = 0.1
            ctx.fillStyle = state.textColor
            ctx.fillText(chars[i], x, y)
            ctx.restore()
          }
          x += cw
        }
      }

      if (now - fadeTimer > 30) {
        fadeTimer = now
        for (let fi = fading.length - 1; fi >= 0; fi--) {
          const f = fading[fi]
          f.alpha -= state.fadeSpeed
          f.y -= state.riseSpeed
          if (f.alpha <= 0) fading.splice(fi, 1)
        }
      }
      for (const f of fading) {
        const fontPx = Math.min(28, Math.max(16, W / 36))
        ctx.font = '700 ' + fontPx + 'px "Source Han Sans SC", Mikodacs, "Microsoft YaHei"'
        ctx.textBaseline = 'alphabetic'
        let x = (W - f.parts.reduce((a, ch) => a + ctx.measureText(ch).width + state.spacing, 0)) / 2
        for (const ch of f.parts) {
          const cw = ctx.measureText(ch).width + state.spacing
          const rad = f.angle
          const ox = f.parts.indexOf(ch) * cw * Math.cos(rad)
          const oy = f.parts.indexOf(ch) * cw * Math.sin(rad)
          ctx.save()
          ctx.globalAlpha = Math.max(0, f.alpha)
          if (f.mode === 'english') {
            ctx.strokeStyle = state.strokeColor
            ctx.lineWidth = 1.6
            ctx.strokeText(ch, x + ox + Math.sin((now + iSeed(ch)) / 300) * 1.5, f.y + oy)
            ctx.fillStyle = state.textColor
            ctx.fillText(ch, x + ox, f.y + oy)
          } else {
            ctx.fillStyle = state.strokeColor
            ctx.fillText(ch, x + ox + 1.6, f.y + oy + 1.6)
            ctx.fillStyle = state.textColor
            ctx.globalAlpha = Math.max(0, f.alpha * 0.95)
            ctx.fillText(ch, x + ox, f.y + oy)
          }
          ctx.restore()
          x += cw
        }
      }

      ;(window as any).__ovDebug = { lines: lines.length, posSec: stateRef.current.posSec, cur, hasChrome: true, now: Math.round(now % 100000) }
      raf = requestAnimationFrame(render)
    }

    function iSeed(_ch: string) { return Math.random() * 6 }

    raf = requestAnimationFrame(render)
    return () => { stopped = true; cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  const title = lyrics?.title ?? ''
  const artist = lyrics?.artist ?? ''

  return (
    <div className="limbus-overlay">
      <canvas ref={canvasRef} className="lo-canvas" />
    </div>
  )
}

function iSeed(_ch: string) { return Math.random() * 6 }
