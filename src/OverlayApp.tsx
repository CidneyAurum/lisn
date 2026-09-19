import { useEffect, useRef, useState } from 'react'

/**
 * 桌面歌词悬浮窗(独立置顶窗口)
 * 忠实移植 TempuraYMY0728/Limbus-Like-Lyric-Simulator 的 effect.py 演出:
 *  - LRC 时间轴驱动,100ms/字 逐字显现(未显现字符不绘制)
 *  - 抖动:每 143ms 每字符随机目标 ±2px,当前值向目标插值 0.3(跳动质感)
 *  - 句完成后保持显现在原地(持续抖动),下一行时间到才切句(等价上游 2000ms 停留)
 *  - 旧句入淡出队列:保持原字号/原角度/原位置,alpha -8/30ms,y -1.5/30ms(向上飘散)
 *  - 新句位置随机(屏幕上部区间)、随机角度 -10°~10°
 *  - 透视:fw = 1 + px·rx + py·ry(px=0.00005·relX, py=0.0003·relY),字符位置与字号除以 fw
 *  - 双层绘制:金描边阴影(offset 3,3)+ 奶白主体(#fffeef/#d8a523)
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
  (t.length < 40 && /^[^\s:：]{1,6}[:：]/.test(t))
// LRC 头部元数据行(「歌名 - 歌手 (Romanization)」):含歌手名且带连字符的短行
const isMetaLine = (t: string, artist: string) =>
  artist.length >= 2 && t.length < 60 && /[-–—]/.test(t) && t.includes(artist)

interface Shake { x: number; y: number; tx: number; ty: number }
interface FadingLine {
  chars: string[]
  alpha: number
  x: number
  y: number
  angle: number
  fontPx: number
  persp: { px: number; py: number; sx: number }
}

export function OverlayApp(): JSX.Element {
  const [ready, setReady] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lyricsRef = useRef<PushedLyrics | null>(null)
  const posRef = useRef(0)
  const cfgRef = useRef<OverlayCfg>({ color: '#fffeef', stroke: '#d8a523', fontSize: 42, glow: true })

  useEffect(() => {
    const bridge = window.overlayBridge
    if (!bridge) return
    bridge.onLyrics(data => { lyricsRef.current = data })
    bridge.onPos(sec => { posRef.current = sec })
    bridge.onConfig?.(cfg => { cfgRef.current = { ...cfgRef.current, ...cfg } })
    window.overlayControls?.ready()
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
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
      const w = canvas.parentElement?.clientWidth ?? 800
      const h = canvas.parentElement?.clientHeight ?? 300
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    // ---- 演出状态机(对齐 effect.py) ----
    let shownIdx = -1            // 当前显示的歌词行索引
    let chars: string[] = []     // 当前句字符
    let charShown = 0            // 已显现字符数
    let anchor = { x: 0, y: 0, angle: 0 }
    let fontPx = 42
    let persp = { px: 0, py: 0, sx: 1 }
    const shakes: Shake[] = []
    const fading: FadingLine[] = []
    let shakeTimer = 0
    let fadeTimer = 0

    const FONT = (px: number) => `700 ${px}px Mikodacs, "Source Han Sans SC", "Microsoft YaHei"`

    const render = () => {
      if (stopped) return
      const W = canvas.width
      const H = canvas.height
      const now = performance.now()
      const posMs = posRef.current * 1000
      const lines = lyricsRef.current?.lines ?? []
      const cfg = cfgRef.current
      ctx.clearRect(0, 0, W, H)

      // ---- 定位当前行(跳过职员表/伴奏/元数据行) ----
      const artist = lyricsRef.current?.artist ?? ''
      let cur = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeMs <= posMs && !isFilteredLine(lines[i].text) && !isMetaLine(lines[i].text, artist)) cur = i
      }

      // ---- 切句 ----
      if (cur !== shownIdx) {
        if (shownIdx >= 0 && charShown > 0) {
          fading.push({
            chars: chars.slice(0, charShown), alpha: 255,
            x: anchor.x, y: anchor.y, angle: anchor.angle, fontPx, persp,
          })
          if (fading.length > 4) fading.shift()
        }
        shownIdx = cur
        if (cur >= 0) {
          chars = Array.from(lines[cur].text)
          charShown = 0
          // 量字体:按窗口宽度等比放大(cfg.fontSize 为 1200px 宽基准),超出窗口宽再缩
          fontPx = Math.min(cfg.fontSize * Math.max(1, W / 1200), Math.max(20, W / 14))
          ctx.font = FONT(fontPx)
          const spacing = 4
          let totalW = chars.reduce((a, ch) => a + ctx.measureText(ch).width + spacing, 0)
          if (totalW > W * 0.92) {
            fontPx = Math.max(16, fontPx * (W * 0.92) / totalW)
            ctx.font = FONT(fontPx)
            totalW = chars.reduce((a, ch) => a + ctx.measureText(ch).width + spacing, 0)
          }
          // 随机锚点(按配置垂直区间,默认上部)+ 随机角度(对齐上游 random 位置/角度)
          const zone = (cfg as any).position ?? 'top'
          const yMin = zone === 'top' ? 0.06 : zone === 'center' ? 0.14 : 0.34
          const yMax = zone === 'top' ? 0.40 : zone === 'center' ? 0.56 : 0.74
          anchor.x = W * 0.04 + Math.random() * Math.max(1, W * 0.92 - totalW)
          anchor.y = H * yMin + Math.random() * Math.max(1, H * (yMax - yMin) - fontPx * 2)
          anchor.angle = Math.random() * 20 - 10
          // 透视系数随句锚点(上游 0.00005/0.0003/0.03)
          const relX = (anchor.x + totalW / 2 - W / 2) / (W / 2)
          const relY = (anchor.y - H / 2) / (H / 2)
          persp = { px: 0.00005 * relX, py: 0.0003 * relY, sx: 1 + 0.03 * Math.max(0, relX) }
          shakes.length = 0
          for (let i = 0; i < chars.length; i++) shakes.push({ x: 0, y: 0, tx: 0, ty: 0 })
        }
      }

      // ---- 逐字显现(100ms/字,由播放进度驱动:暂停定格、seek 同步) ----
      if (cur >= 0) {
        charShown = Math.min(chars.length, Math.max(0, Math.floor((posMs - lines[cur].timeMs) / 100) + 1))
      }

      // ---- 抖动(143ms 节拍:随机目标 ±2 + 0.3 插值,对齐上游 shake timer) ----
      if (now - shakeTimer > 143) {
        shakeTimer = now
        for (const sh of shakes) {
          sh.tx = Math.random() * 4 - 2
          sh.ty = Math.random() * 4 - 2
          sh.x += (sh.tx - sh.x) * 0.3
          sh.y += (sh.ty - sh.y) * 0.3
        }
      }

      // ---- 淡出行更新(30ms 节拍:alpha-8 / y-1.5,保持字号角度位置) ----
      if (now - fadeTimer > 30) {
        fadeTimer = now
        for (let fi = fading.length - 1; fi >= 0; fi--) {
          const f = fading[fi]
          f.alpha -= 8
          f.y -= 1.5
          if (f.alpha <= 0) fading.splice(fi, 1)
        }
      }

      // ---- 绘制淡出行 ----
      for (const f of fading) {
        drawLine(ctx, f.chars, f.x, f.y, f.angle, f.fontPx, f.persp, cfg, f.alpha / 255, null, W)
      }
      // ---- 绘制当前句(已显现部分) ----
      if (cur >= 0 && charShown > 0) {
        drawLine(ctx, chars.slice(0, charShown), anchor.x, anchor.y, anchor.angle, fontPx, persp, cfg, 1, shakes, W)
      }

      raf = requestAnimationFrame(render)
    }

    const drawLine = (
      ctx2: CanvasRenderingContext2D, drawChars: string[], x0: number, y0: number, angleDeg: number,
      fpx: number, prs: { px: number; py: number; sx: number }, cfg: OverlayCfg,
      alpha: number, shakesArr: Shake[] | null, W: number,
    ) => {
      if (!drawChars.length) return
      ctx2.save()
      ctx2.font = FONT(fpx)
      ctx2.textBaseline = 'alphabetic'
      ctx2.globalAlpha = alpha
      if (cfg.glow) { ctx2.shadowColor = cfg.stroke; ctx2.shadowBlur = 14 }
      const rad = (angleDeg * Math.PI) / 180
      const spacing = 4
      let cursor = 0
      for (let i = 0; i < drawChars.length; i++) {
        const ch = drawChars[i]
        const cw = ctx2.measureText(ch).width + spacing
        // 沿角度排布 → 透视除 fw → 水平补偿 sx(上游 persp_transform 语义)
        const rx = cursor * Math.cos(rad)
        const ry = cursor * Math.sin(rad)
        const fw = Math.min(1.6, Math.max(0.6, 1 + prs.px * rx + prs.py * ry))
        const dx = x0 + (prs.sx * rx) / fw
        const dy = y0 + ry / fw
        const jx = shakesArr ? shakesArr[i]?.x ?? 0 : 0
        const jy = shakesArr ? shakesArr[i]?.y ?? 0 : 0
        // 阴影层(金,offset 3,3)
        ctx2.shadowBlur = 0
        ctx2.fillStyle = cfg.stroke
        ctx2.fillText(ch, dx + jx + 3, dy + jy + 3 + fpx / fw)
        // 主体层(奶白)
        if (cfg.glow) { ctx2.shadowColor = cfg.stroke; ctx2.shadowBlur = 14 }
        ctx2.fillStyle = cfg.color
        ctx2.font = FONT(fpx / fw)
        ctx2.fillText(ch, dx + jx, dy + jy + fpx / fw)
        cursor += cw
      }
      ctx2.restore()
    }

    raf = requestAnimationFrame(render)
    return () => { stopped = true; cancelAnimationFrame(raf); ro.disconnect() }
  }, [ready])

  return (
    <div className="limbus-overlay">
      <canvas ref={canvasRef} className="lo-canvas" />
    </div>
  )
}
