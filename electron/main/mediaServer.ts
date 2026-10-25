import http from 'node:http'
import fs from 'node:fs'
import { UA } from './sources/spi'

export interface MediaServerOptions {
  headerTimeoutMs?: number
  stallTimeoutMs?: number
  maxAttempts?: number
  retryDelayMs?: number
}

interface StreamCtx {
  songJson?: string
  quality?: string
  pinned?: string | null
}

interface ByteRange { start?: number; end?: number; suffix?: number }
interface ContentRange { start: number; end: number; total?: number }

function parseRange(value: string): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : undefined
  const end = match[2] ? Number(match[2]) : undefined
  if ([start, end].some(n => n !== undefined && !Number.isSafeInteger(n))) return null
  if (start === undefined) return end! > 0 ? { suffix: end } : null
  return end !== undefined && end < start ? null : { start, end }
}

function parseContentRange(value: string | null): ContentRange | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? '')
  if (!match) return null
  const start = Number(match[1]); const end = Number(match[2])
  const total = match[3] === '*' ? undefined : Number(match[3])
  if (![start, end, total].every(n => n === undefined || Number.isSafeInteger(n)) || end < start || (total !== undefined && end >= total)) return null
  return { start, end, total }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('stream cancelled')
}

/** Observe cancellation even when a resolver cannot cancel its underlying work. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    work.then(value => { signal.removeEventListener('abort', onAbort); resolve(value) }, error => {
      signal.removeEventListener('abort', onAbort); reject(error)
    })
  })
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal)) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function waitForDrain(res: http.ServerResponse, signal: AbortSignal): Promise<void> {
  if (res.destroyed || signal.aborted) return Promise.reject(abortReason(signal))
  if (!res.writableNeedDrain) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.removeListener('drain', onDrain); res.removeListener('close', onClose); res.removeListener('error', onError)
      signal.removeEventListener('abort', onClose)
    }
    const onDrain = () => { cleanup(); resolve() }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const onClose = () => { cleanup(); reject(abortReason(signal)) }
    res.once('drain', onDrain); res.once('close', onClose); res.once('error', onError)
    signal.addEventListener('abort', onClose, { once: true })
  })
}

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
  private clients = new Set<AbortController>()
  private readonly options: Required<MediaServerOptions>
  port = 0
  /** 上游反复失败时用于重新解析新地址(由 index.ts 注入 registry) */
  freshUrlProvider: ((songJson: string, quality: string, pinned: string | null) => Promise<string | null>) | null = null

  constructor(options: MediaServerOptions = {}) {
    this.options = { headerTimeoutMs: 20_000, stallTimeoutMs: 30_000, maxAttempts: 5, retryDelayMs: 300, ...options }
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => { try { res.destroy() } catch { /* ignore */ } })
    })
    // 长音频流不被 Node 默认超时掐断(默认 requestTimeout 5 分钟)
    this.server.requestTimeout = 0
    this.server.timeout = 0
    this.server.headersTimeout = 60_000
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.removeListener('error', reject)
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
      // URLSearchParams already decodes once; a literal '%' or '%20' is part of the filename.
      const p = u.searchParams.get('p') ?? ''
      if (!/\.(mp3|flac|lrc)$/i.test(p) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return }
      const stat = fs.statSync(p)
      if (!stat.isFile()) { res.writeHead(404); res.end(); return }
      const ctype = /\.flac$/i.test(p) ? 'audio/flac' : /\.lrc$/i.test(p) ? 'text/plain; charset=utf-8' : 'audio/mpeg'
      let start = 0; let end = stat.size - 1
      if (req.headers.range) {
        const range = parseRange(req.headers.range)
        if (!range || !stat.size || (range.start !== undefined && range.start >= stat.size)) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size, 'Accept-Ranges': 'bytes' }); res.end(); return
        }
        start = range.suffix !== undefined ? Math.max(0, stat.size - range.suffix) : range.start!
        end = Math.min(range.end ?? end, end)
      }
      const headers: Record<string, string | number> = { 'Content-Type': ctype, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes' }
      if (req.headers.range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size
      res.writeHead(req.headers.range ? 206 : 200, headers)
      if (req.method === 'HEAD' || !stat.size) { res.end(); return }
      const file = fs.createReadStream(p, { start, end })
      const cancel = () => file.destroy()
      res.once('close', cancel)
      file.once('error', () => res.destroy())
      file.once('close', () => res.removeListener('close', cancel))
      file.pipe(res)
      return
    }
    res.writeHead(404); res.end()
  }

  /**
   * 无缝上游代理:上游断开/卡死时,用 Range 从已发送字节处续拉;
   * 若重新解析改变地址,交给播放器按时间点恢复,避免拼接不同音频的字节。
   */
  private async proxyStream(target: string, req: http.IncomingMessage, res: http.ServerResponse, ctx: StreamCtx): Promise<void> {
    const clientRange = req.headers.range
    const requestedRange = clientRange ? parseRange(clientRange) : undefined
    if (clientRange && !requestedRange) { res.writeHead(416); res.end(); return }
    const client = new AbortController()
    const onClose = () => client.abort(new Error('client disconnected'))
    this.clients.add(client)
    req.once('aborted', onClose)
    res.once('close', onClose)
    let url = target
    let sent = 0
    let baseOffset = 0
    let responseEnd: number | undefined
    let expectedBytes: number | undefined
    let totalSize: number | undefined
    let headersWritten = false
    let consecutiveSameUrlFails = 0

    try {
      for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
        const controller = new AbortController()
        const cancelUpstream = () => controller.abort(abortReason(client.signal))
        client.signal.addEventListener('abort', cancelUpstream, { once: true })
        let upstream: Response | undefined
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          client.signal.throwIfAborted()
          const headers: Record<string, string> = {
            'User-Agent': UA, Referer: refererFor(url), Accept: '*/*', 'Accept-Encoding': 'identity'
          }
          if (headersWritten) headers.Range = 'bytes=' + (baseOffset + sent) + '-' + (responseEnd ?? '')
          else if (clientRange) headers.Range = clientRange
          // This deadline covers response headers only. A whole-body timeout cuts every long song.
          const headerTimer = setTimeout(() => controller.abort(new Error('upstream headers timed out')), this.options.headerTimeoutMs)
          try { upstream = await fetch(url, { headers, redirect: 'follow', signal: controller.signal }) }
          finally { clearTimeout(headerTimer) }
          if (upstream.status === 416 && !headersWritten) {
            const rangeHeader = upstream.headers.get('content-range')
            res.writeHead(416, rangeHeader ? { 'Content-Range': rangeHeader } : {}); res.end(); return
          }
          if (upstream.status !== 200 && upstream.status !== 206) throw new Error('upstream status ' + upstream.status)
          if (!upstream.body) throw new Error('upstream no body')
          const ctype = upstream.headers.get('content-type') ?? ''
          if (!/audio|octet-stream|mpeg|flac|mp3|m4a|aac|ogg|wav/i.test(ctype)) throw new Error('upstream not audio: ' + ctype.slice(0, 40))
          const contentRange = upstream.status === 206 ? parseContentRange(upstream.headers.get('content-range')) : null
          if (upstream.status === 206 && !contentRange) throw new Error('invalid upstream content-range')
          const rawLength = upstream.headers.get('content-length')
          const contentLength = rawLength !== null && /^\d+$/.test(rawLength) && Number.isSafeInteger(Number(rawLength)) ? Number(rawLength) : undefined
          let skip = 0
          if (!headersWritten) {
            if (contentRange) {
              const wantedStart = requestedRange?.start ?? (requestedRange?.suffix !== undefined && contentRange.total !== undefined
                ? Math.max(0, contentRange.total - requestedRange.suffix) : contentRange.start)
              if (contentRange.start !== wantedStart || (!requestedRange && contentRange.start !== 0)) throw new Error('upstream range starts at wrong offset')
              if (requestedRange?.end !== undefined && contentRange.end > requestedRange.end) throw new Error('upstream range exceeds request')
              if (contentLength !== undefined && contentLength !== contentRange.end - contentRange.start + 1) throw new Error('upstream range length mismatch')
              baseOffset = contentRange.start
              responseEnd = contentRange.end
              totalSize = contentRange.total
              expectedBytes = contentRange.end - contentRange.start + 1
            } else {
              // A server may ignore the initial Range and return the entire file as HTTP 200.
              baseOffset = 0
              expectedBytes = contentLength
              responseEnd = contentLength !== undefined ? contentLength - 1 : undefined
              totalSize = contentLength
            }
            const h: Record<string, string> = { 'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
            if (contentRange) h['Content-Range'] = 'bytes ' + contentRange.start + '-' + contentRange.end + '/' + (contentRange.total ?? '*')
            if (expectedBytes !== undefined) h['Content-Length'] = String(expectedBytes)
            res.writeHead(upstream.status, h)
            headersWritten = true
          } else if (contentRange) {
            const wanted = baseOffset + sent
            if (contentRange.start !== wanted || (totalSize !== undefined && contentRange.total !== undefined && totalSize !== contentRange.total)) {
              throw new Error('range mismatch: got ' + contentRange.start + ' want ' + wanted)
            }
          } else {
            // A retry ignored Range. Skip the absolute file offset, including the client's seek.
            skip = baseOffset + sent
          }
          if (req.method === 'HEAD' || expectedBytes === 0) { res.end(); return }
          reader = upstream.body.getReader()
          for (;;) {
            client.signal.throwIfAborted()
            const stallTimer = setTimeout(() => controller.abort(new Error('upstream stalled')), this.options.stallTimeoutMs)
            let chunk: ReadableStreamReadResult<Uint8Array>
            try { chunk = await reader.read() }
            finally { clearTimeout(stallTimer) }
            controller.signal.throwIfAborted()
            if (chunk.done) {
              if (skip > 0 || (expectedBytes !== undefined && sent < expectedBytes)) throw new Error('upstream ended before the requested bytes arrived')
              res.end(); return
            }
            let value = chunk.value
            if (skip > 0) {
              const skipped = Math.min(skip, value.length)
              value = value.subarray(skipped)
              skip -= skipped
            }
            if (expectedBytes !== undefined) value = value.subarray(0, Math.max(0, expectedBytes - sent))
            if (value.length) {
              sent += value.length
              if (!res.write(Buffer.from(value))) await waitForDrain(res, client.signal)
            }
            if (expectedBytes !== undefined && sent >= expectedBytes) { res.end(); return }
          }
        } catch (e) {
          if (client.signal.aborted || res.writableEnded || res.destroyed) return
          consecutiveSameUrlFails++
          console.log('[media] 上游中断,第' + attempt + '次重连: ' + String(e).slice(0, 80) + ' (已发送 ' + sent + ' 字节)')
          if (attempt >= this.options.maxAttempts) {
            if (!headersWritten) { res.writeHead(502); res.end() }
            else res.destroy()
            return
          }
        } finally {
          client.signal.removeEventListener('abort', cancelUpstream)
          controller.abort()
          try { if (reader) await reader.cancel(); else await upstream?.body?.cancel() } catch { /* already closed */ }
          finally { try { reader?.releaseLock() } catch { /* already released */ } }
        }
        // Same-url failures may request a fresh address; cancellation must not wait for parsing.
        if (consecutiveSameUrlFails >= 2 && ctx.songJson && this.freshUrlProvider) {
          try {
            const fresh = await abortable(this.freshUrlProvider(ctx.songJson, ctx.quality ?? '320k', ctx.pinned ?? null), client.signal)
            if (fresh && fresh !== url) {
              // A new parser URL may be another platform, codec, or bitrate. Byte offsets are
              // not interchangeable; let the renderer reopen at the saved playback time.
              if (headersWritten) { res.destroy(); return }
              url = fresh
              consecutiveSameUrlFails = 0
            }
          } catch { if (client.signal.aborted) return }
        }
        await sleep(this.options.retryDelayMs * attempt, client.signal)
      }
    } finally {
      client.abort()
      this.clients.delete(client)
      req.removeListener('aborted', onClose)
      res.removeListener('close', onClose)
    }
  }

  stop(): void {
    for (const client of this.clients) client.abort(new Error('media server stopped'))
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
  }
}
