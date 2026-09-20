import fs from 'node:fs'
import path from 'node:path'
import { MusicFreeHost } from './host'
import { SourceProvider, Song, SongOrigin, Platform, markOk, markFail, withTimeout } from '../spi'

export interface MfSourceEntry {
  id: string                 // 插件短 id，如 xiaowo
  name: string               // 显示名，如 小蜗音乐(酷我)
  platform: string           // 映射到统一平台的标识 kw/kg/tx/wy/mg
  file: string               // keep-alive 仓库内路径 Music_Free/xiaowo.js
  repo: string
  branch: string
  rawUrl: string
  jsdelivrUrl: string
  enabled: boolean
  version?: string
  remoteDate?: string
}

/** keep-alive 的 5 个 MusicFree 插件（搜索走各平台官方接口，取流走 Huibq 后端） */
export const DEFAULT_MF_SOURCES: MfSourceEntry[] = [
  {
    id: 'xiaowo', name: '小蜗音乐（酷我）', platform: 'kw', enabled: true,
    file: 'Music_Free/xiaowo.js', repo: 'Huibq/keep-alive', branch: 'master',
    rawUrl: 'https://raw.githubusercontent.com/Huibq/keep-alive/master/Music_Free/xiaowo.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/Huibq/keep-alive@master/Music_Free/xiaowo.js'
  },
  {
    id: 'xiaogou', name: '小蜗·狗（酷狗）', platform: 'kg', enabled: true,
    file: 'Music_Free/xiaogou.js', repo: 'Huibq/keep-alive', branch: 'master',
    rawUrl: 'https://raw.githubusercontent.com/Huibq/keep-alive/master/Music_Free/xiaogou.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/Huibq/keep-alive@master/Music_Free/xiaogou.js'
  },
  {
    id: 'xiaoqiu', name: '小秋音乐（QQ音乐）', platform: 'tx', enabled: true,
    file: 'Music_Free/xiaoqiu.js', repo: 'Huibq/keep-alive', branch: 'master',
    rawUrl: 'https://raw.githubusercontent.com/Huibq/keep-alive/master/Music_Free/xiaoqiu.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/Huibq/keep-alive@master/Music_Free/xiaoqiu.js'
  },
  {
    id: 'xiaoyun', name: '小芸音乐（网易云）', platform: 'wy', enabled: true,
    file: 'Music_Free/xiaoyun.js', repo: 'Huibq/keep-alive', branch: 'master',
    rawUrl: 'https://raw.githubusercontent.com/Huibq/keep-alive/master/Music_Free/xiaoyun.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/Huibq/keep-alive@master/Music_Free/xiaoyun.js'
  },
  {
    id: 'xiaomi', name: '小蜜音乐（咪咕）', platform: 'mg', enabled: true,
    file: 'Music_Free/xiaomi.js', repo: 'Huibq/keep-alive', branch: 'master',
    rawUrl: 'https://raw.githubusercontent.com/Huibq/keep-alive/master/Music_Free/xiaomi.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/Huibq/keep-alive@master/Music_Free/xiaomi.js'
  }
]

interface MfConfig { entries: MfSourceEntry[] }

export class MusicFreeManager {
  entries: MfSourceEntry[] = []
  hosts = new Map<string, MusicFreeHost>()

  constructor(private dir: string) {}

  private configPath(): string { return path.join(this.dir, 'mf-config.json') }
  private scriptPath(id: string): string { return path.join(this.dir, 'scripts', 'mf-' + id + '.js') }

  async init(): Promise<void> {
    fs.mkdirSync(path.join(this.dir, 'scripts'), { recursive: true })
    let cfg: MfConfig | null = null
    try { cfg = JSON.parse(fs.readFileSync(this.configPath(), 'utf-8')) } catch { /* first run */ }
    this.entries = cfg?.entries?.length ? cfg.entries : JSON.parse(JSON.stringify(DEFAULT_MF_SOURCES))
    for (const d of DEFAULT_MF_SOURCES) {
      if (!this.entries.some(e => e.id === d.id)) this.entries.push(JSON.parse(JSON.stringify(d)))
    }
    this.save()
  }

  private save(): void {
    fs.writeFileSync(this.configPath(), JSON.stringify({ entries: this.entries }, null, 2))
  }

  private async fetchCode(entry: MfSourceEntry): Promise<string> {
    const urls = [entry.rawUrl, entry.jsdelivrUrl].filter(Boolean) as string[]
    let lastErr: unknown = null
    for (const u of urls) {
      try {
        const res = await withTimeout(fetch(u, { headers: { 'User-Agent': 'GlassMusic/0.1' }, signal: AbortSignal.timeout(15000) }), 16000)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const text = await res.text()
        if (text.length < 40) throw new Error('内容无效')
        return text
      } catch (e) { lastErr = e }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  async loadAll(): Promise<{ ok: string[]; failed: { id: string; err: string }[] }> {
    const ok: string[] = []
    const failed: { id: string; err: string }[] = []
    for (const entry of this.entries) {
      if (!entry.enabled) continue
      try {
        let code = this.readCached(entry.id)
        if (!code || code.length < 40) {
          code = await this.fetchCode(entry)
          fs.writeFileSync(this.scriptPath(entry.id), code)
        }
        const host = new MusicFreeHost({ id: entry.id, name: entry.name })
        host.load(code)
        this.hosts.set(entry.id, host)
        ok.push(entry.id)
      } catch (e) {
        failed.push({ id: entry.id, err: e instanceof Error ? e.message : String(e) })
      }
    }
    return { ok, failed }
  }

  private readCached(id: string): string | null {
    try { return fs.readFileSync(this.scriptPath(id), 'utf-8') } catch { return null }
  }

  setEnabled(id: string, enabled: boolean): void {
    const e = this.entries.find(x => x.id === id)
    if (!e) return
    e.enabled = enabled
    if (!enabled) this.hosts.delete(id)
    this.save()
  }

  async checkUpdates(): Promise<void> {
    for (const entry of this.entries) {
      if (!entry.repo) continue
      try {
        const u = 'https://api.github.com/repos/' + entry.repo + '/commits?path=' + encodeURIComponent(entry.file) + '&per_page=1'
        const res = await withTimeout(fetch(u, { headers: { 'User-Agent': 'GlassMusic/0.1', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) }), 11000)
        if (!res.ok) continue
        const arr: any = await res.json()
        if (Array.isArray(arr) && arr[0]) entry.remoteDate = arr[0]?.commit?.committer?.date ?? arr[0]?.commit?.author?.date
      } catch { /* 下次再查 */ }
    }
    this.save()
  }

  async upgrade(id: string): Promise<{ ok: boolean; detail: string }> {
    const entry = this.entries.find(e => e.id === id)
    if (!entry) return { ok: false, detail: '未知音源 ' + id }
    try {
      const code = await this.fetchCode(entry)
      const old = this.readCached(id)
      const backupDir = path.join(this.dir, 'backup')
      fs.mkdirSync(backupDir, { recursive: true })
      if (old) fs.writeFileSync(path.join(backupDir, 'mf-' + id + '.' + Date.now() + '.js'), old)
      fs.writeFileSync(this.scriptPath(id), code)
      const host = new MusicFreeHost({ id, name: entry.name })
      host.load(code)
      this.hosts.set(id, host)
      entry.remoteDate = new Date().toISOString()
      this.save()
      return { ok: true, detail: '已升级到最新' }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  providerFor(entry: MfSourceEntry): SourceProvider | null {
    const host = this.hosts.get(entry.id)
    if (!host) return null
    const self = this
    const platform = entry.platform as Platform
    const provider: SourceProvider = {
      id: 'mf:' + entry.id,
      name: entry.name,
      kind: 'musicfree-plugin',
      caps: { platforms: [platform], qualities: ['320k', '128k'], supportsSearch: true },
      health: { status: 'ok', okCount: 0, failCount: 0 },
      async search(keyword: string, page: number): Promise<Song[]> {
        const h = self.hosts.get(entry.id)
        if (!h) throw new Error('插件未加载: ' + entry.id)
        const t0 = Date.now()
        try {
          const r = await h.searchMusic(keyword, page, platform)
          markOk(provider, Date.now() - t0)
          const out: Song[] = []
          for (const it of r.items) {
            if (!it?.title && !it?.name) continue
            const name = String(it.title ?? it.name)
            const artist = String(it.artist ?? '未知歌手')
            const origin: SongOrigin = {
              providerId: provider.id, platform,
              songId: String(it.id ?? ''),
              hash: platform === 'kg' ? String(it.id ?? '') : undefined,
              extra: { mfItem: it }
            }
            if (!origin.songId) continue
            out.push({
              key: (name + '|' + artist.split('/')[0]).toLowerCase(),
              name, artist,
              album: it.album ? String(it.album) : undefined,
              durationMs: it.duration ? Number(it.duration) * 1000 : undefined,
              origins: [origin],
              picUrl: typeof it.artwork === 'string' ? it.artwork : undefined
            })
          }
          return out
        } catch (e) { markFail(provider, e); return [] }
      },
      async resolveUrl(origin: SongOrigin, quality: string): Promise<string> {
        const h = self.hosts.get(entry.id)
        if (!h) throw new Error('插件未加载: ' + entry.id)
        const item = (origin.extra as any)?.mfItem
        if (!item) throw new Error('缺少插件歌曲数据（请重新搜索）')
        // MusicFree quality: low=128k standard=192? high=320k super=flac —— 映射到插件语义
        const q = quality === 'flac' ? 'super' : quality === '320k' ? 'high' : 'low'
        const t0 = Date.now()
        try {
          const url = await h.resolveUrl(item, q)
          markOk(provider, Date.now() - t0)
          return url
        } catch (e) { markFail(provider, e); throw e }
      },
      getLyric: async (origin: SongOrigin) => {
        const h = self.hosts.get(entry.id)
        const item = (origin.extra as any)?.mfItem
        if (!h || !item) return undefined
        return h.getLyric(item)
      },
      test: async () => {
        try {
          const r = await this.hosts.get(entry.id)!.searchMusic('晴天', 1, platform)
          return { ok: r.items.length > 0, detail: '搜索返回 ' + r.items.length + ' 条' }
        } catch (e) { return { ok: false, detail: String(e) } }
      },
      dispose: () => { self.hosts.delete(entry.id) }
    }
    return provider
  }
}
