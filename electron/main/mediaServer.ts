import http from 'node:http'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { UA } from './sources/spi'

export class MediaServer {
  private server: http.Server | null = null
  port = 0

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => { try { res.destroy() } catch { /* ignore */ } })
    })
    await new Promise<void>(resolve => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port
        resolve()
      })
    })
  }

  streamUrlFor(target: string): string {
    return 'http://127.0.0.1:' + this.port + '/stream?u=' + Buffer.from(target, 'utf-8').toString('base64url')
  }

  localUrlFor(filePath: string): string {
    return 'http://127.0.0.1:' + this.port + '/local?p=' + encodeURIComponent(filePath)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname === '/stream') {
      const target = Buffer.from(u.searchParams.get('u') ?? '', 'base64url').toString('utf-8')
      if (!/^https?:/i.test(target)) { res.writeHead(400); res.end(); return }
      const headers: Record<string, string> = { 'User-Agent': UA }
      const range = req.headers.range
      if (range) headers.Range = range
      const upstream = await fetch(target, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) })
      const h: Record<string, string> = {
        'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
      const cr = upstream.headers.get('content-range')
      const cl = upstream.headers.get('content-length')
      if (cr) h['Content-Range'] = cr
      if (cl) h['Content-Length'] = cl
      res.writeHead(upstream.status, h)
      if (upstream.body) (Readable.fromWeb(upstream.body as any) as any).pipe(res)
      else res.end()
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

  stop(): void { this.server?.close() }
}
