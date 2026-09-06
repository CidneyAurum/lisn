import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { write as id3Write } from 'node-id3'
import { SourceRegistry, ResolveError } from './sources/registry'
import { Song, UA } from './sources/spi'
import { SettingsStore } from './settings'

export interface DownloadItem {
  id: string
  name: string
  artist: string
  album?: string
  quality: string
  status: 'waiting' | 'resolving' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  progress: number
  received: number
  total: number
  filePath?: string
  error?: string
  sourceId?: string
  platform?: string
  createdAt: number
}

function sanitizeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class DownloadManager {
  queue: DownloadItem[] = []
  private songs = new Map<string, Song>()
  private running = false

  constructor(
    private registry: SourceRegistry,
    private settings: SettingsStore,
    private emit: (channel: string, payload: any) => void
  ) {}

  enqueue(song: Song, quality: string): DownloadItem {
    const item: DownloadItem = {
      id: 'dl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name: song.name, artist: song.artist, album: song.album,
      quality, status: 'waiting', progress: 0, received: 0, total: 0,
      createdAt: Date.now()
    }
    this.songs.set(item.id, song)
    this.queue.unshift(item)   // 最新请求优先
    this.emitList()
    void this.pump()
    return item
  }

  cancel(id: string): void {
    const item = this.queue.find(i => i.id === id)
    if (!item) return
    if (item.status === 'waiting' || item.status === 'failed') { item.status = 'cancelled'; this.emitList() }
    // 下载中的任务由 fetch 流自然中断标记（简化：标记后等待完成）
  }

  retry(id: string): void {
    const item = this.queue.find(i => i.id === id)
    if (item && (item.status === 'failed' || item.status === 'cancelled')) {
      item.status = 'waiting'; item.error = undefined; item.progress = 0; item.received = 0
      this.emitList(); void this.pump()
    }
  }

  remove(id: string): void {
    this.queue = this.queue.filter(i => i.id !== id)
    this.songs.delete(id)
    this.emitList()
  }

  clearFinished(): void {
    this.queue = this.queue.filter(i => i.status === 'waiting' || i.status === 'resolving' || i.status === 'downloading')
    this.emitList()
  }

  private emitList(): void {
    this.emit('dl:queue', this.queue)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (true) {
        const next = this.queue.find(i => i.status === 'waiting')
        if (!next) break
        await this.runOne(next)
        // 节流：免费音源明示"频繁请求会封 IP"（Huibq README），单任务间隔由设置控制
        if (this.queue.some(i => i.status === 'waiting')) await sleep(this.settings.get().intervalMs)
      }
    } finally { this.running = false }
  }

  private async runOne(item: DownloadItem): Promise<void> {
    const song = this.songs.get(item.id)
    if (!song) { item.status = 'failed'; item.error = '歌曲数据丢失'; this.emitList(); return }
    try {
      item.status = 'resolving'; this.emitList()
      const res = await this.registry.resolveUrl(song, item.quality)
      item.sourceId = res.providerId; item.platform = res.platform
      item.status = 'downloading'; item.progress = 0; this.emitList()

      const dir = this.settings.get().downloadDir
      fs.mkdirSync(dir, { recursive: true })
      const ext = res.quality === 'flac' ? '.flac' : '.mp3'
      const base = sanitizeName(item.artist + ' - ' + item.name)
      let filePath = path.join(dir, base + ext)
      let n = 1
      while (fs.existsSync(filePath)) { filePath = path.join(dir, base + ' (' + n + ')' + ext); n++ }

      const upstream = await fetch(res.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
      if (!upstream.ok || !upstream.body) throw new Error('下载源 HTTP ' + upstream.status)
      const total = Number(upstream.headers.get('content-length') ?? 0)
      item.total = total
      item.filePath = filePath

      const ws = fs.createWriteStream(filePath)
      const reader = Readable.fromWeb(upstream.body as any)
      let received = 0
      let lastEmit = 0
      reader.on('data', (chunk: Buffer) => {
        received += chunk.length
        item.received = received
        item.progress = total ? Math.min(received / total, 1) : 0
        if (Date.now() - lastEmit > 300) { lastEmit = Date.now(); this.emitList() }
      })
      await new Promise<void>((resolve, reject) => {
        reader.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', () => resolve())
        ;(reader as any).pipe(ws)
      })
      if (received < 1000) throw new Error('文件过小，疑似失败（' + received + 'B）')

      // MP3：写入 ID3 标签 + 封面内嵌（flac 跳过标签）
      if (ext === '.mp3') {
        try {
          const tags: any = { title: item.name, artist: item.artist, album: song.album ?? '' }
          const picUrl = await this.registry.getPic(song).catch(() => undefined)
          if (picUrl) {
            const pr = await fetch(picUrl, { signal: AbortSignal.timeout(10000) })
            if (pr.ok) {
              const buf = Buffer.from(await pr.arrayBuffer())
              if (buf.length > 500) tags.image = { mime: picUrl.endsWith('.png') ? 'image/png' : 'image/jpeg', type: 3, description: 'Cover', imageBuffer: buf }
            }
          }
          id3Write(tags, filePath)
        } catch { /* 标签写入失败不影响音频文件 */ }
      }
      // 歌词 .lrc
      try {
        const lrc = await this.registry.getLyric(song)
        if (lrc) fs.writeFileSync(filePath.replace(/\.(mp3|flac)$/i, '.lrc'), lrc, 'utf-8')
      } catch { /* ignore */ }

      item.status = 'completed'
      item.progress = 1
      item.received = received
      item.total = total || received
      this.emitList()
    } catch (e) {
      item.status = 'failed'
      item.error = e instanceof ResolveError ? e.message : (e instanceof Error ? e.message : String(e))
      // 清理残留半截文件
      try { if (item.filePath && fs.existsSync(item.filePath)) fs.unlinkSync(item.filePath) } catch { /* ignore */ }
      this.emitList()
    }
  }
}
