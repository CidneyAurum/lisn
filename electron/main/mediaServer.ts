import http from 'node:http'
import fs from 'node:fs'
import { UA } from './sources/spi'

/** 上游无数据超过该毫秒数即判定卡死,自动断线重连续传 */
const STALL_MS = 30_000
const MAX_ATTEMPTS = 5

interface StreamCtx {
  songJson?: string
  quality?: string
  pinned?: string | null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 按上游域名给出合理 Referer(部分 CDN 校验来源) */
function refererFor(url: string): string {
  try {
    const h = new URL(url).hostname
    if (h.includes('126.net') || h.includes('163.com')) return 'https://music.163.com/'
    if (h.includes('qq.com') || h.includes('qqmusic')) return 'https://y.qq.com/'
    if (h.includes('kuwo')) return 'https://www.kuwo.cn/'
    if (h.includes('kugou')) return 'https://www.kugou.com/'
    if (h.includes('migu')) return 'https://music.migu.cn/'
    return 'https://music.163.com/'
  } catch { return 'https://music.163.com/' }
}

export class MediaServer {
  private server: http.Server | null = null
  port = 0
  /** 上游反复失败时用于重新解析新地址(由 index.ts 注入 registry) */
  freshUrlProvider: ((songJson: string, quality: string, pinned: string | null) => Promise<string | null>) | null = null

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => { try { res.destroy() } catch { /* ignore */ } })
    })
    // 长音频流不被 Node 默认超时掐断(默认 requestTimeout 5 分钟)
    this.server.requestTimeout = 0
    this.server.timeout = 0
    this.server.headersTimeout = 60_000
    await new Promise<void>(resolve => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port
        resolve()
      })
    })
  }

  /** 生成代理流地址;携带歌曲上下文以便上游故障时自动换源重连 */
  streamUrlFor(target: string, ctx?: StreamCtx): string {
    let url = 'http://127.0.0.1:' + this.port + '/stream?u=' + Buffer.from(target, 'utf-8').toString('base64url')
    if (ctx?.songJson) {
      url += '&k=' + Buffer.from(ctx.songJson, 'utf-8').toString('base64url')
      url += '&q=' + encodeURIComponent(ctx.quality ?? '320k')
      if (ctx.pinned) url += '&p=' + encodeURIComponent(ctx.pinned)
    }
    return url
  }

  localUrlFor(filePath: string): string {
    return 'http://127.0.0.1:' + this.port + '/local?p=' + encodeURIComponent(filePath)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname === '/stream') {
      const target = Buffer.from(u.searchParams.get('u') ?? '', 'base64url').toString('utf-8')
      if (!/^https?:/i.test(target)) { res.writeHead(400); res.end(); return }
      const ctx: StreamCtx = {
        songJson: u.searchParams.get('k') ? Buffer.from(u.searchParams.get('k')!, 'base64url').toString('utf-8') : undefined,
        quality: u.searchParams.get('q') ?? undefined,
        pinned: u.searchParams.get('p')
      }
      await this.proxyStream(target, req, res, ctx)
      return
    }
    if (u.pathname === '/local') {
      const p = decodeURIComponent(u.searchParams.get('p') ?? '')
      if (!/\.(mp3|flac|lrc)$/i.test(p) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return }
      const stat = fs.statSync(p)
      const range = req.headers.range
      const ctype = p.endsWith('.flac') ? 'audio/flac' : 'audio/mpeg'
      const m = range ? range.match(/bytes=(\d*)-(\d*)/) : null
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0
        const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1
        res.writeHead(206, {
          'Content-Type': ctype,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes'
        })
        fs.createReadStream(p, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' })
        fs.createReadStream(p).pipe(res)
      }
      return
    }
    res.writeHead(404); res.end()
  }

  /**
   * 无缝上游代理:上游断开/卡死时,用 Range 从已发送字节处续拉;
   * 同一地址连续失败时重新解析换源。对播放器完全透明。
   */
  private async proxyStream(target: string, req: http.IncomingMessage, res: http.ServerResponse, ctx: StreamCtx): Promise<void> {
    const clientRange = req.headers.range
    let url = target
    let sent = 0
    let headersWritten = false
    let consecutiveSameUrlFails = 0

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const headers: Record<string, string> = {
          'User-Agent': UA,
          // 部分 CDN(网易云等)缺 Referer 会中途掐断长连接
          Referer: refererFor(url),
          Accept: '*/*'
        }
        if (sent > 0) headers.Range = 'bytes=' + sent + '-'
        else if (clientRange) headers.Range = clientRange
        const upstream = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
        if (!upstream.ok && upstream.status !== 206) throw new Error('upstream status ' + upstream.status)
        if (!upstream.body) throw new Error('upstream no body')
        // 内容类型校验:URL 过期时 CDN 常返回 XML/HTML 错误页,
        // 若当音频喂给解码器会报 "PTS is not defined" 导致播放中断
        const ctype = upstream.headers.get('content-type') ?? ''
        if (!/audio|octet-stream|mpeg|flac|mp3|m4a|aac|ogg|wav/i.test(ctype)) {
          try { await upstream.body.cancel() } catch { /* ignore */ }
          throw new Error('upstream not audio: ' + ctype.slice(0, 40))
        }
        if (!headersWritten) {
          const h: Record<string, string> = {
            'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
          }
          if (attempt === 1) {
            // 首次请求:如实透传上游的长度/范围信息
            const cr = upstream.headers.get('content-range')
            const cl = upstream.headers.get('content-length')
            if (cr) h['Content-Range'] = cr
            if (cl) h['Content-Length'] = cl
            res.writeHead(upstream.status, h)
          } else {
            // 续传重连:已发送 sent 字节,长度声明不再成立 → 分块传输(避免播放器长度错位)
            res.writeHead(upstream.status === 206 ? 200 : upstream.status, h)
          }
          headersWritten = true
        }
        // 续传起点校验:错位会让音频流 PTS 断裂(FFmpeg "PTS is not defined")
        let skip = 0
        if (sent > 0) {
          if (upstream.status === 200) {
            skip = sent // 上游忽略 Range 返回整段:跳过已发送字节
          } else {
            const cr = upstream.headers.get('content-range') ?? ''
            const m = cr.match(/bytes\s+(\d+)-/)
            const start = m ? parseInt(m[1], 10) : null
            if (start === null || start !== sent) {
              // 起点不可信:断流交给播放器自愈(断点续播),避免错位损坏时间轴
              try { await upstream.body.cancel() } catch { /* ignore */ }
              throw new Error('range mismatch: got ' + (start ?? 'none') + ' want ' + sent)
            }
          }
        }
        const reader = (upstream.body as ReadableStream<Uint8Array>).getReader()
        for (;;) {
          const stalled = Symbol('stalled')
          const chunk = await Promise.race([
            reader.read(),
            sleep(STALL_MS).then(() => stalled)
          ])
          if (chunk === stalled) {
            try { await reader.cancel() } catch { /* ignore */ }
            throw new Error('upstream stalled ' + STALL_MS + 'ms')
          }
          const { done, value } = chunk as ReadableStreamReadResult<Uint8Array>
          if (done) break
          if (!value?.length) continue
          if (skip > 0) {
            if (value.length <= skip) { skip -= value.length; continue }
            const part = value.subarray(skip)
            skip = 0
            if (!res.write(Buffer.from(part))) await new Promise<void>(r => res.once('drain', () => r()))
            sent += part.length
            continue
          }
          if (!res.write(Buffer.from(value))) await new Promise<void>(r => res.once('drain', () => r()))
          sent += value.length
        }
        res.end()
        return
      } catch (e) {
        if (res.writableEnded || res.destroyed) return
        consecutiveSameUrlFails++
        console.log('[media] 上游中断,第' + attempt + '次重连: ' + String(e).slice(0, 80) + ' (已发送 ' + sent + ' 字节)')
        if (attempt >= MAX_ATTEMPTS) { try { res.destroy() } catch { /* ignore */ } return }
        // 同址连续失败 ≥2 次:重新解析换新地址(免费源链接有时效)
        if (consecutiveSameUrlFails >= 2 && ctx.songJson && this.freshUrlProvider) {
          try {
            const fresh = await this.freshUrlProvider(ctx.songJson, ctx.quality ?? '320k', ctx.pinned ?? null)
            if (fresh && fresh !== url) { url = fresh; consecutiveSameUrlFails = 0; console.log('[media] 已换新解析地址续传') }
          } catch { /* 保持原地址重试 */ }
        }
        await sleep(300 * attempt)
      }
    }
  }

  stop(): void { this.server?.close() }
}
