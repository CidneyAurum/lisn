import { useEffect, useRef, useState } from 'react'

/**
 * 桌面歌词悬浮窗(独立置顶窗口)
 * 忠实移植 TempuraYMY0728/Limbus-Like-Lyric-Simulator 的 effect.py 演出:
 *  - LRC 时间轴驱动,100ms/字 逐字显现(未显现字符不绘制)
 *  - 抖动:每 143ms 每字符随机目标 ±2px,当前值向目标插值 0.3(跳动质感)
 *  - 句完成后保持显现在原地,下一行时间到才切句(等价上游 2000ms 停留)
 *  - 旧句入淡出队列:保持原字号/角度/位置,alpha -8/30ms,y -1.5/30ms(向上飘散)
 *  - 新句位置随机(按配置垂直区间)、随机角度 -10°~10°
 *  - 透视:fw = 1 + px·rx + py·ry,字符位置与字号除以 fw
 *  - 双层绘制:金描边阴影(offset 3,3)+ 奶白主体(#fffeef/#d8a523)
 * 性能:字符精灵缓存(阴影/辉光只渲染一次,帧内仅 drawImage)+ 30fps 上限
 *      + 闲置自动停机(无当前行/暂停定格时零循环开销,数据变化唤醒)
 * 数据:主窗口经主进程推送 overlay:lyrics / overlay:pos(60ms 节流)
 * 交互:整窗点击穿透,关闭只从应用内部
 */

interface PushedLyrics {
  lines: { timeMs: number; text: string }[]
  title: string
  artist: string
}

interface OverlayCfg { color: string; stroke: string; fontSize: number; glow: boolean }

declare global {
  interface Window {
    overlayBridge: {
      onLyrics(cb: (data: PushedLyrics) => void): () => void
      onPos(cb: (sec: number) => void): () => void
      onConfig(cb: (cfg: OverlayCfg) => void): () => void
    }
    overlayControls: {
      ready(): void
      setLocked(v: boolean): void
    }
  }
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
const isFilteredLine = (t: string) => CREDIT_PATTERNS.some(re => re.test(t)) || INST_PATTERNS.some(re => re.test(t)) ||
  (t.length < 40 && /^[^\s:：]{1,6}[：:]/.test(t))
// LRC 头部元数据行(「歌名 - 歌手 (Romanization)」):含歌手名且带连字符的短行
const isMetaLine = (t: string, artist: string) =>
  artist.length >= 2 && t.length < 60 && /[-–—]/.test(t) && t.includes(artist)

const GLOW_PAD = 22
const SHADOW_OFF = 3
const FONT_STACK = 'Mikodacs, "Source Han Sans SC", "Microsoft YaHei"'
const fontOf = (px: number) => `700 ${px}px ${FONT_STACK}`

/** 字符精灵:阴影+辉光+主体一次渲染,运行期仅 drawImage */
function makeCharSprite(ch: string, fontPx: number, color: string, stroke: string, glow: boolean): HTMLCanvasElement {
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = fontOf(fontPx)
  const w = Math.ceil(measure.measureText(ch).width)
  const h = Math.ceil(fontPx * 1.35)
  const cv = document.createElement('canvas')
  cv.width = w + GLOW_PAD * 2 + SHADOW_OFF
  cv.height = h + GLOW_PAD * 2 + SHADOW_OFF
  const c = cv.getContext('2d')!
  c.font = fontOf(fontPx)
  c.textBaseline = 'alphabetic'
  const bx = GLOW_PAD
  const by = GLOW_PAD + Math.ceil(fontPx)
  c.fillStyle = stroke
  c.fillText(ch, bx + SHADOW_OFF, by + SHADOW_OFF)
  if (glow) { c.shadowColor = stroke; c.shadowBlur = 14 }
  c.fillStyle = color
  c.fillText(ch, bx, by)
  return cv
}

interface Shake { x: number; y: number; tx: number; ty: number }
interface FadingLine {
  sprite: HTMLCanvasElement
  alpha: number
  x: number
  y: number
}

export function OverlayApp(): JSX.Element {
  const [ready, setReady] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lyricsRef = useRef<PushedLyrics | null>(null)
  const posRef = useRef(0)
  const posChangedAtRef = useRef(0)
  const cfgRef = useRef<OverlayCfg>({ color: '#fffeef', stroke: '#d8a523', fontSize: 42, glow: true })
  const wakeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const bridge = window.overlayBridge
    if (!bridge) return
    bridge.onLyrics(data => { lyricsRef.current = data; wakeRef.current() })
    bridge.onPos(sec => {
      if (posRef.current !== sec) { posRef.current = sec; posChangedAtRef.current = performance.now() }
      wakeRef.current()
    })
    bridge.onConfig?.(cfg => { cfgRef.current = { ...cfgRef.current, ...cfg }; wakeRef.current() })
    window.overlayControls?.ready()
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let stopped = false
    Promise.all([
      document.fonts.load('700 34px Mikodacs'),
      document.fonts.load('700 34px "Source Han Sans SC"'),
    ]).then(() => wakeRef.current()).catch(() => {})

    const resize = () => {
      const w = canvas.parentElement?.clientWidth ?? 800
      const h = canvas.parentElement?.clientHeight ?? 300
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; wakeRef.current() }
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    // ---- 演出状态机(对齐 effect.py) ----
    let shownIdx = -1
    let chars: string[] = []
    let charShown = 0
    let anchor = { x: 0, y: 0, angle: 0 }
    let fontPx = 42
    let persp = { px: 0, py: 0, sx: 1 }
    let widths: number[] = []
    let charSprites: HTMLCanvasElement[] = []
    let lineSprite: HTMLCanvasElement | null = null
    let linePad = GLOW_PAD + SHADOW_OFF
    const shakes: Shake[] = []
    const fading: FadingLine[] = []
    let shakeTimer = 0
    let fadeTimer = 0
    let lastDrawn = 0

    const buildLineSprites = (cfg: OverlayCfg) => {
      const m = document.createElement('canvas').getContext('2d')!
      m.font = fontOf(fontPx)
      widths = chars.map(ch => m.measureText(ch).width + 4)
      const totalW = widths.reduce((a, b) => a + b, 0)
      charSprites = chars.map(ch => makeCharSprite(ch, fontPx, cfg.color, cfg.stroke, cfg.glow))
      // 整行 sprite(淡出用;无抖动)
      const pad = GLOW_PAD + SHADOW_OFF
      const lh = Math.ceil(fontPx * 1.35)
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.ceil(totalW) + pad * 2)
      cv.height = lh + pad * 2
      const c = cv.getContext('2d')!
      c.font = fontOf(fontPx)
      c.textBaseline = 'alphabetic'
      let x = pad
      if (cfg.glow) { c.shadowColor = cfg.stroke; c.shadowBlur = 14 }
      for (let i = 0; i < chars.length; i++) {
        c.fillStyle = cfg.stroke
        c.fillText(chars[i], x + SHADOW_OFF, pad + Math.ceil(fontPx) + SHADOW_OFF)
        c.fillStyle = cfg.color
        c.fillText(chars[i], x, pad + Math.ceil(fontPx))
        x += widths[i]
      }
      lineSprite = cv
      linePad = pad
    }

    /** 单帧;返回 false 表示进入闲置(调用方停止调度) */
    const render = (): boolean => {
      const W = canvas.width
      const H = canvas.height
      const now = performance.now()
      const posMs = posRef.current * 1000
      const lines = lyricsRef.current?.lines ?? []
      const cfg = cfgRef.current
      const paused = now - posChangedAtRef.current > 2500

      // ---- 定位当前行(跳过职员表/伴奏/元数据行) ----
      const artist = lyricsRef.current?.artist ?? ''
      let cur = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeMs <= posMs && !isFilteredLine(lines[i].text) && !isMetaLine(lines[i].text, artist)) cur = i
      }

      // ---- 闲置判定:无当前行且无淡出行;或暂停定格且无淡出行 ----
      if ((cur < 0 && fading.length === 0) || (paused && fading.length === 0)) {
        if (fading.length === 0 && (cur < 0 || shownIdx >= 0)) {
          ctx.clearRect(0, 0, W, H)
          if (cur < 0) shownIdx = -1
        }
        return false
      }

      // ---- 切句 ----
      if (cur !== shownIdx) {
        if (shownIdx >= 0 && charShown > 0 && lineSprite) {
          fading.push({ sprite: lineSprite, alpha: 255, x: anchor.x - linePad, y: anchor.y - linePad })
          if (fading.length > 4) fading.shift()
        }
        shownIdx = cur
        if (cur >= 0) {
          chars = Array.from(lines[cur].text)
          charShown = 0
          fontPx = Math.min(cfg.fontSize * Math.max(1, W / 1200), Math.max(20, W / 14))
          const m = document.createElement('canvas').getContext('2d')!
          m.font = fontOf(fontPx)
          let totalW = chars.reduce((a, ch) => a + m.measureText(ch).width + 4, 0)
          if (totalW > W * 0.92) {
            fontPx = Math.max(16, fontPx * (W * 0.92) / totalW)
            m.font = fontOf(fontPx)
            totalW = chars.reduce((a, ch) => a + m.measureText(ch).width + 4, 0)
          }
          const zone = (cfg as any).position ?? 'top'
          const yMin = zone === 'top' ? 0.06 : zone === 'center' ? 0.14 : 0.34
          const yMax = zone === 'top' ? 0.40 : zone === 'center' ? 0.56 : 0.74
          anchor.x = W * 0.04 + Math.random() * Math.max(1, W * 0.92 - totalW)
          anchor.y = H * yMin + Math.random() * Math.max(1, H * (yMax - yMin) - fontPx * 2)
          anchor.angle = Math.random() * 20 - 10
          const relX = (anchor.x + totalW / 2 - W / 2) / (W / 2)
          const relY = (anchor.y - H / 2) / (H / 2)
          persp = { px: 0.00005 * relX, py: 0.0003 * relY, sx: 1 + 0.03 * Math.max(0, relX) }
          shakes.length = 0
          for (let i = 0; i < chars.length; i++) shakes.push({ x: 0, y: 0, tx: 0, ty: 0 })
          buildLineSprites(cfg)
        }
      }

      // ---- 逐字显现(100ms/字,由播放进度驱动) ----
      if (cur >= 0) {
        charShown = Math.min(chars.length, Math.max(0, Math.floor((posMs - lines[cur].timeMs) / 100) + 1))
      }

      // ---- 抖动(143ms 节拍) ----
      if (now - shakeTimer > 143) {
        shakeTimer = now
        for (const sh of shakes) {
          sh.tx = Math.random() * 4 - 2
          sh.ty = Math.random() * 4 - 2
          sh.x += (sh.tx - sh.x) * 0.3
          sh.y += (sh.ty - sh.y) * 0.3
        }
      }

      // ---- 淡出行更新(30ms 节拍) ----
      if (now - fadeTimer > 30) {
        fadeTimer = now
        for (let fi = fading.length - 1; fi >= 0; fi--) {
          const f = fading[fi]
          f.alpha -= 8
          f.y -= 1.5
          if (f.alpha <= 0) fading.splice(fi, 1)
        }
      }

      // ---- 绘制(30fps 上限) ----
      if (now - lastDrawn >= 33) {
        lastDrawn = now
        ctx.clearRect(0, 0, W, H)
        for (const f of fading) {
          ctx.globalAlpha = Math.max(0, f.alpha / 255)
          ctx.drawImage(f.sprite, f.x, f.y)
        }
        ctx.globalAlpha = 1
        if (cur >= 0 && charShown > 0) {
          const rad = (anchor.angle * Math.PI) / 180
          const baseline = Math.ceil(fontPx)
          let cursor = 0
          for (let i = 0; i < charShown && i < chars.length; i++) {
            const sp = charSprites[i]
            if (!sp) { cursor += widths[i] ?? 0; continue }
            const rx = cursor * Math.cos(rad)
            const ry = cursor * Math.sin(rad)
            const fw = Math.min(1.6, Math.max(0.6, 1 + persp.px * rx + persp.py * ry))
            const dx = anchor.x + (persp.sx * rx) / fw
            const dy = anchor.y + ry / fw
            const jx = shakes[i]?.x ?? 0
            const jy = shakes[i]?.y ?? 0
            ctx.drawImage(
              sp,
              dx + jx - GLOW_PAD / fw, dy + baseline + jy - GLOW_PAD / fw,
              sp.width / fw, sp.height / fw,
            )
            cursor += widths[i] ?? 0
          }
        }
      }
      return true
    }

    // ---- 循环驱动:闲置自动停机,数据变化唤醒 ----
    let rafActive = false
    const frame = () => {
      if (stopped || !rafActive) return
      if (render()) requestAnimationFrame(frame)
      else rafActive = false
    }
    wakeRef.current = () => {
      if (!stopped && !rafActive) {
        rafActive = true
        requestAnimationFrame(frame)
      }
    }
    wakeRef.current()
    return () => { stopped = true; rafActive = false; ro.disconnect() }
  }, [ready])

  return (
    <div className="limbus-overlay">
      <canvas ref={canvasRef} className="lo-canvas" />
    </div>
  )
}
