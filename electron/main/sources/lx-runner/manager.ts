import fs from 'node:fs'
import path from 'node:path'
import { LxScriptHost } from './host'
import { SourceProvider, SongOrigin, Platform, markOk, markFail, withTimeout } from '../spi'

export interface LxSourceEntry {
  id: string
  name: string
  rawUrl: string
  jsdelivrUrl?: string
  repo?: string        // GitHub 同步升级：owner/repo
  file?: string        // 仓库内文件路径
  branch?: string
  enabled: boolean
  localVersion?: string
  sha?: string         // 最近一次加载脚本的 commit sha
  remoteDate?: string
}

export const DEFAULT_LX_SOURCES: LxSourceEntry[] = [
  {
    id: 'huibq', name: 'Huibq 音源', enabled: true,
    repo: 'Huibq/keep-alive', file: 'render_api.js', branch: 'master',
    rawUrl: 'https://raw.githubusercontent.com/Huibq/keep-alive/master/render_api.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/Huibq/keep-alive@master/render_api.js'
  },
  {
    id: 'ikun', name: 'ikun 音源', enabled: true,
    repo: 'pdone/lx-music-source', file: 'ikun/latest.js', branch: 'main',
    rawUrl: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/ikun/latest.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/ikun/latest.js'
  },
  {
    id: 'qdy', name: '全豆要聚合音源', enabled: true,
    repo: 'pdone/lx-music-source', file: 'qdy/latest.js', branch: 'main',
    rawUrl: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js'
  },
  {
    id: 'sixyin', name: '六音音源', enabled: false,
    repo: 'pdone/lx-music-source', file: 'sixyin/latest.js', branch: 'main',
    rawUrl: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/sixin/latest.js',
    jsdelivrUrl: 'https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/sixin/latest.js'
  }
]

interface PersistShape {
  entries: LxSourceEntry[]
  resolveOrder: string[]   // URL 解析优先级（provider id 列表）
}

function parseScriptMeta(code: string): { name?: string; version?: string } {
  const m = code.slice(0, 600)
  const name = (m.match(/@name\s+([^\r\n*]+)/) || [])[1]?.trim()
  const version = (m.match(/@version\s+([^\r\n*]+)/) || [])[1]?.trim()
  return { name, version }
}

/** lx musicInfo 字段约定（实测 render_api.js: songId = musicInfo.hash ?? musicInfo.songmid） */
export function buildMusicInfo(origin: SongOrigin): any {
  const mi: any = { songmid: origin.songId, source: origin.platform }
  if (origin.platform === 'kg') mi.hash = origin.hash ?? origin.songId
  if (origin.platform === 'mg') mi.copyrightId = origin.copyrightId ?? origin.songId
  return mi
}

export class LxSourceManager {
  entries: LxSourceEntry[] = []
  resolveOrder: string[] = []
  hosts = new Map<string, LxScriptHost>()

  constructor(private dir: string) {}

  private configPath(): string { return path.join(this.dir, 'lx-config.json') }
  private scriptPath(id: string): string { return path.join(this.dir, 'scripts', id + '.js') }

  async init(): Promise<void> {
    fs.mkdirSync(path.join(this.dir, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(this.dir, 'backup'), { recursive: true })
    let persisted: PersistShape | null = null
    try { persisted = JSON.parse(fs.readFileSync(this.configPath(), 'utf-8')) } catch { /* first run */ }
    this.entries = persisted?.entries?.length ? persisted.entries : JSON.parse(JSON.stringify(DEFAULT_LX_SOURCES))
    for (const d of DEFAULT_LX_SOURCES) {
      if (!this.entries.some(e => e.id === d.id)) this.entries.push(JSON.parse(JSON.stringify(d)))
    }
    this.resolveOrder = persisted?.resolveOrder?.length
      ? persisted.resolveOrder
      : this.entries.filter(e => e.enabled).map(e => 'lx:' + e.id).concat(['gd'])
    this.save()
  }

  private save(): void {
    fs.writeFileSync(this.configPath(), JSON.stringify({ entries: this.entries, resolveOrder: this.resolveOrder }, null, 2))
  }

  private async fetchScriptCode(entry: LxSourceEntry): Promise<string> {
    const urls = [entry.rawUrl, entry.jsdelivrUrl].filter(Boolean) as string[]
    let lastErr: unknown = null
    for (const u of urls) {
      try {
        const res = await withTimeout(fetch(u, { headers: { 'User-Agent': 'GlassMusic/0.1' }, signal: AbortSignal.timeout(15000) }), 16000)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const text = await res.text()
        if (text.startsWith('404') || text.length < 40) throw new Error('内容无效')
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
        const cached = this.readCached(entry.id)
        let code: string
        if (cached && cached.length > 40) code = cached
        else { code = await this.fetchScriptCode(entry); fs.writeFileSync(this.scriptPath(entry.id), code) }
        const meta = parseScriptMeta(code)
        entry.localVersion = meta.version ?? entry.localVersion
        const host = new LxScriptHost({ id: entry.id, name: meta.name ?? entry.name, version: meta.version })
        host.run(code)
        await host.waitInited(6000)
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

  providerFor(entry: LxSourceEntry): SourceProvider | null {
    const host = this.hosts.get(entry.id)
    if (!host) return null
    const platforms = Object.keys(host.sources) as Platform[]
    const qualities = [...new Set(Object.values(host.sources).flatMap(s => s.qualitys ?? []))]
    const self = this
    const provider: SourceProvider = {
      id: 'lx:' + entry.id,
      name: entry.name,
      kind: 'lx-script',
      caps: { platforms, qualities, supportsSearch: false },
      health: { status: 'ok', okCount: 0, failCount: 0 },
      async resolveUrl(origin: SongOrigin, quality: string): Promise<string> {
        const h = self.hosts.get(entry.id)
        if (!h) throw new Error('音源未加载: ' + entry.id)
        const t0 = Date.now()
        try {
          const url = await withTimeout(h.resolveMusicUrl(origin.platform, quality, buildMusicInfo(origin)), 15000)
          markOk(provider, Date.now() - t0)
          return url
        } catch (e) { markFail(provider, e); throw e }
      },
      test: () => Promise.resolve({ ok: platforms.length > 0, detail: '已加载，平台: ' + platforms.join('/') + '，音质: ' + qualities.join('/') }),
      dispose: () => { self.hosts.delete(entry.id) }
    }
    return provider
  }

  // ---------- GitHub 仓库同步 + 选择性升级 ----------
  async checkUpdates(): Promise<void> {
    for (const entry of this.entries) {
      if (!entry.repo || !entry.file || !entry.branch) continue
      try {
        const u = 'https://api.github.com/repos/' + entry.repo + '/commits?path=' + encodeURIComponent(entry.file) + '&sha=' + entry.branch + '&per_page=1'
        const res = await withTimeout(fetch(u, { headers: { 'User-Agent': 'GlassMusic/0.1', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) }), 11000)
        if (!res.ok) continue
        const arr: any = await res.json()
        if (Array.isArray(arr) && arr[0]) {
          entry.remoteDate = arr[0]?.commit?.committer?.date ?? arr[0]?.commit?.author?.date
        }
      } catch { /* 网络问题静默，下次再查 */ }
    }
    this.save()
  }

  markLoadedSha(id: string, sha: string): void {
    const e = this.entries.find(x => x.id === id)
    if (e) { e.sha = sha; this.save() }
  }

  /** 勾选升级：拉取最新脚本 → 备份旧脚本 → 落盘 → 重载沙箱 */
  async upgrade(id: string): Promise<{ ok: boolean; detail: string }> {
    const entry = this.entries.find(e => e.id === id)
    if (!entry) return { ok: false, detail: '未知音源 ' + id }
    try {
      const code = await this.fetchScriptCode(entry)
      const old = this.readCached(id)
      if (old) fs.writeFileSync(path.join(this.dir, 'backup', id + '.' + Date.now() + '.js'), old)
      fs.writeFileSync(this.scriptPath(id), code)
      const meta = parseScriptMeta(code)
      const host = new LxScriptHost({ id: entry.id, name: meta.name ?? entry.name, version: meta.version })
      host.run(code)
      await host.waitInited(6000)
      this.hosts.set(id, host)
      entry.localVersion = meta.version ?? entry.localVersion
      entry.remoteDate = new Date().toISOString()
      this.save()
      return { ok: true, detail: '已升级到 ' + (meta.version ?? '最新') }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  rollback(id: string): { ok: boolean; detail: string } {
    const dir = path.join(this.dir, 'backup')
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(id + '.')).sort() : []
    if (!files.length) return { ok: false, detail: '无备份可回滚' }
    fs.copyFileSync(path.join(dir, files[files.length - 1]), this.scriptPath(id))
    return { ok: true, detail: '已回滚到 ' + files[files.length - 1] + '（重载后生效）' }
  }

  setEnabled(id: string, enabled: boolean): void {
    const e = this.entries.find(x => x.id === id)
    if (!e) return
    e.enabled = enabled
    if (!enabled) this.hosts.delete(id)
    this.save()
  }

  setResolveOrder(order: string[]): void { this.resolveOrder = order; this.save() }

  async addCustom(name: string, url: string): Promise<{ ok: boolean; detail: string; id?: string }> {
    const id = 'custom-' + Date.now().toString(36)
    try {
      const res = await withTimeout(fetch(url, { headers: { 'User-Agent': 'GlassMusic/0.1' }, signal: AbortSignal.timeout(15000) }), 16000)
      const code = await res.text()
      if (!res.ok || code.length < 40) throw new Error('脚本内容无效')
      fs.writeFileSync(this.scriptPath(id), code)
      const meta = parseScriptMeta(code)
      const entry: LxSourceEntry = { id, name: name || meta.name || '自定义音源', rawUrl: url, enabled: true, localVersion: meta.version }
      const host = new LxScriptHost({ id, name: entry.name, version: meta.version })
      host.run(code)
      await host.waitInited(6000)
      this.hosts.set(id, host)
      this.entries.push(entry)
      this.resolveOrder.push('lx:' + id)
      this.save()
      return { ok: true, detail: '已添加并加载', id }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  async reload(id: string): Promise<{ ok: boolean; detail: string }> {
    const entry = this.entries.find(e => e.id === id)
    if (!entry) return { ok: false, detail: '未知音源' }
    try {
      const code = this.readCached(id) ?? await this.fetchScriptCode(entry)
      const meta = parseScriptMeta(code)
      const host = new LxScriptHost({ id: entry.id, name: meta.name ?? entry.name, version: meta.version })
      host.run(code)
      await host.waitInited(6000)
      this.hosts.set(id, host)
      return { ok: true, detail: '已重载' }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }
}
