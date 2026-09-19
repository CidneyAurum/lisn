import { useEffect, useRef, useState } from 'react'

/**
 * 桌面歌词悬浮窗(独立置顶窗口)
 * 数据由主窗口经主进程推送:overlay:lyrics(歌词行+曲名)/ overlay:pos(播放秒数)
 * 交互:顶部把手拖动移动;锁定后全窗口点击穿透
 */

interface LrcLine { timeMs: number; text: string }

interface PushedLyrics {
  lines: { timeMs: number; text: string }[]
  title: string
  artist: string
}

export function OverlayApp(): JSX.Element {
  const [lyrics, setLyrics] = useState<PushedLyrics | null>(null)
  const [posSec, setPosSec] = useState(0)
  const [locked, setLocked] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ lyrics, posSec })
  stateRef.current = { lyrics, posSec }

  useEffect(() => {
    const push = (window as any).overlayBridge
    if (!push) return
    push.onLyrics((data: PushedLyrics) => setLyrics(data))
    push.onPos((sec: number) => setPosSec(sec))
    ;(window as any).overlayControls?.ready()
  }, [])

  // 锁定切换:穿透鼠标(歌词纯展示)
  useEffect(() => {
    ;(window as any).overlayControls?.setLocked(locked)
  }, [locked])

  // Canvas 演出循环(与 LimbusPerformance 同款视觉)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const resize = () => {
      canvas.width = Math.max(300, canvas.parentElement?.clientWidth ?? 600)
      canvas.height = Math.max(120, canvas.parentElement?.clientHeight ?? 160)
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    let raf = 0
    let stopped = false
    const fading: { chars: string[]; alpha: number; y: number; angle: number }[] = []
    let lastLineIdx = -1
    let shakeSeed: number[] = []

    const setFont = (px: number) => { ctx.font = `bold ${px}px "Microsoft YaHei", "PingFang SC", sans-serif` }

    const render = () => {
      if (stopped) return
      const W = canvas.width
      const H = canvas.height
      const now = performance.now()
      const { lyrics: pushed, posSec: pos } = stateRef.current
      ctx.clearRect(0, 0, W, H)

      const lines = pushed?.lines ?? []
      let cur = -1
      for (let i = 0; i < lines.length; i++) if (lines[i].timeMs <= pos * 1000) cur = i
      let line: { timeMs: number; text: string } | null = cur >= 0 ? lines[cur] : null
      let lineDur = 4000
      if (line) lineDur = Math.max(1500, (lines[cur + 1]?.timeMs ?? pos * 1000 + 4000) - line.timeMs)

      if (line && cur !== lastLineIdx) {
        const prev = lastLineIdx >= 0 && lastLineIdx < lines.length ? lines[lastLineIdx].text : null
        if (prev) {
          fading.push({ chars: Array.from(prev), alpha: 1, y: H * 0.34, angle: (Math.random() * 14 - 7) * Math.PI / 180 })
          if (fading.length > 3) fading.shift()
        }
        shakeSeed = Array.from(line.text).map(() => Math.random() * Math.PI * 2)
        lastLineIdx = cur
      }

      // 淡出旧行
      for (let fi = fading.length - 1; fi >= 0; fi--) {
        const f = fading[fi]
        f.alpha -= 0.01
        f.y -= 0.7
        if (f.alpha <= 0) { fading.splice(fi, 1); continue }
        const fontPx = Math.min(30, Math.max(18, W / 30))
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
          ctx.fillStyle = '#d8a523'
          ctx.fillText(ch, x + ox + 2, f.y + oy + 2)
          ctx.fillStyle = '#fffeef'
          ctx.globalAlpha = Math.max(0, f.alpha * 0.95)
          ctx.fillText(ch, x + ox, f.y + oy)
          ctx.restore()
          x += cw
        }
      }

      // 当前行逐字显现 + 抖动
      if (line) {
        const chars = Array.from(line.text)
        const shown = Math.min(chars.length, Math.ceil(((pos * 1000 - line.timeMs) / lineDur) * chars.length * 1.4))
        const fontPx = Math.min(34, Math.max(20, W / 26))
        setFont(fontPx)
        ctx.textBaseline = 'alphabetic'
        const widths = chars.map(ch => ctx.measureText(ch).width + 4)
        const totalW = widths.reduce((a, b) => a + b, 0)
        let x = (W - totalW) / 2
        const y = H * 0.56
        for (let i = 0; i < chars.length; i++) {
          const cw = widths[i]
          const jx = Math.sin(now / 90 + shakeSeed[i] * 7) * 2
          const jy = Math.cos(now / 110 + shakeSeed[i] * 11) * 1.4
          if (i < shown) {
            ctx.save()
            ctx.globalAlpha = 0.85
            ctx.fillStyle = '#d8a523'
            ctx.fillText(chars[i], x + jx + 2.2, y + jy + 2.2)
            ctx.fillStyle = '#0d0d0d'
            ctx.globalAlpha = 0.55
            ctx.fillText(chars[i], x + jx + 1, y + jy + 1)
            ctx.fillStyle = '#fffeef'
            ctx.globalAlpha = 1
            ctx.fillText(chars[i], x + jx, y + jy)
            ctx.restore()
          } else {
            ctx.save()
            ctx.globalAlpha = 0.1
            ctx.fillStyle = '#fffeef'
            ctx.fillText(chars[i], x, y)
            ctx.restore()
          }
          x += cw
        }
      }

      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => { stopped = true; cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  const title = lyrics?.title ?? ''
  const artist = lyrics?.artist ?? ''

  return (
    <div className="limbus-overlay">
      {/* 拖动把手 + 控制(锁定时隐藏) */}
      <div className={'lo-chrome' + (locked ? ' locked' : '')}>
        <span className="lo-title">{title ? title + ' · ' + artist : '聆 LISN 桌面歌词'}</span>
        <button className="lo-btn" onClick={() => setLocked(v => !v)} title={locked ? '解锁' : '锁定(点击穿透)'}>
          {locked ? '已锁定' : '锁定'}
        </button>
        <button className="lo-btn" onClick={() => window.close()} title="关闭悬浮窗">✕</button>
      </div>
      <canvas ref={canvasRef} className="lo-canvas" />
    </div>
  )
}
