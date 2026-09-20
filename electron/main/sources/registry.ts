import { SourceProvider, Song, SongOrigin, withTimeout } from './spi'
import { GdProvider } from './gdapi'
import { HttpGenericProvider, HttpSourceConfig } from './http-generic'
import { LxSourceManager } from './lx-runner/manager'
import { MusicFreeManager } from './musicfree/manager'

export class ResolveError extends Error {
  constructor(msg: string, public code: 'all-failed' | 'manual-blocked' = 'all-failed') { super(msg) }
}

export interface ResolveResult {
  url: string
  providerId: string
  platform: string
  quality: string
  crossPlatform?: boolean
  note?: string
}

export interface SearchPage {
  songs: Song[]
  hasMore: boolean
  page: number
}

const QUALITY_CHAIN: Record<string, string[]> = {
  flac: ['flac', '320k', '128k'],
  '320k': ['320k', '128k'],
  '128k': ['128k', '320k']
}

/** 强归一化:去空白/标点、全角转半角、统一大小写,使不同源的同一首歌合并为一条 */
function normText(s: string): string {
  let out = ''
  for (const ch of String(s ?? '')) {
    const code = ch.codePointAt(0)!
    // 全角 ASCII → 半角
    const c = code >= 0xff01 && code <= 0xff5e ? String.fromCodePoint(code - 0xfee0) : ch
    if (/[\s()（）\[\]【】{}·・\-—–_,.、!！?？'"“”‘’:：;；/\|&+*#~^$@%]/.test(c)) continue
    out += c.toLowerCase()
  }
  return out
}

function normalizeKey(name: string, artist: string): string {
  // 歌手只取第一位(跨源常出现 "A/B" vs "A" 的差异)
  const firstArtist = String(artist ?? '').split(/[/、,&]|feat\.?/i)[0]
  return normText(name) + '|' + normText(firstArtist).slice(0, 8)
}

function mergeSongs(target: Map<string, Song>, list: Song[]): number {
  let added = 0
  for (const s of list) {
    if (!s?.name) continue
    const key = normalizeKey(s.name, s.artist)
    const found = target.get(key)
    if (found) {
      for (const o of s.origins) {
        if (!found.origins.some(x => x.platform === o.platform && x.songId === o.songId)) found.origins.push(o)
      }
      if (!found.album && s.album) found.album = s.album
      if (!found.picUrl && s.picUrl) found.picUrl = s.picUrl
    } else {
      target.set(key, { ...s, key, origins: [...s.origins] })
      added++
    }
  }
  return added
}

export class SourceRegistry {
  gd = new GdProvider()
  providers: SourceProvider[] = []
  mode: 'auto' | 'manual' = 'auto'
  private picCache = new Map<string, string>()
  private mergedSongs = new Map<string, Song>()
  private lastKeyword = ''
  private lastPage = 0

  constructor(public lx: LxSourceManager, public mf?: MusicFreeManager) {}

  rebuild(httpTemplates: HttpSourceConfig[] = []): void {
    const list: SourceProvider[] = []
    for (const entry of this.lx.entries) {
      if (!entry.enabled) continue
      const p = this.lx.providerFor(entry)
      if (p) list.push(p)
    }
    for (const entry of this.mf?.entries ?? []) {
      if (!entry.enabled) continue
      const p = this.mf?.providerFor(entry)
      if (p) list.push(p)
    }
    for (const t of httpTemplates) {
      if (t.enabled !== false) list.push(new HttpGenericProvider(t))
    }
    list.push(this.gd)
    const order = this.lx.resolveOrder ?? []
    list.sort((a, b) => {
      const ia = order.indexOf(a.id); const ib = order.indexOf(b.id)
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib)
    })
    this.providers = list
  }

  snapshot() {
    return this.providers.map(p => ({ id: p.id, name: p.name, kind: p.kind, caps: p.caps, health: p.health }))
  }

  /**
   * 聚合分页搜索：
   * - GD（wy/kw）：count=75 × pages=N
   * - MusicFree 插件（kw/kg/tx/wy...）：各平台官方接口原生翻页
   * 合并去重累计（same keyword 翻页增量追加）
   */
  async search(keyword: string, page = 1): Promise<SearchPage> {
    const searchers = this.providers.filter(p => p.search && p.health.status !== 'disabled')
    const lists = await Promise.all(searchers.map(p => p.search!(keyword, page).catch(() => [] as Song[])))

    // 关键词变了 → 清空累计缓存
    if (this.lastKeyword !== keyword || page <= this.lastPage) {
      this.mergedSongs.clear()
      this.lastKeyword = keyword
      this.lastPage = 0
    }
    mergeSongs(this.mergedSongs, lists.flat())
    this.lastPage = Math.max(this.lastPage, page)

    const songs = [...this.mergedSongs.values()]
    const totalThisPage = lists.reduce((n, l) => n + l.length, 0)
    // hasMore：本页任一源还有数据（GD 75/页满页视为还有；插件 isEnd 信息在 provider 内部已消化——返回条数>0 即可能还有）
    const hasMore = totalThisPage >= 20
    return { songs, hasMore, page }
  }

  private async tryProvider(
    p: SourceProvider, song: Song, chain: string[], errBox: { err?: unknown }
  ): Promise<ResolveResult | null> {
    const origins = song.origins.filter(o => p.caps.platforms.includes(o.platform as any))
    if (!origins.length) return null
    for (const q of chain) {
      if (!p.caps.qualities.includes(q)) continue
      for (const o of origins) {
        try {
          const url = await withTimeout(p.resolveUrl(o, q), 15000)
          return { url, providerId: p.id, platform: o.platform, quality: q }
        } catch (e) { errBox.err = e }
      }
    }
    return null
  }

  async resolveUrl(song: Song, quality: string, opts?: { pinnedProviderId?: string | null }): Promise<ResolveResult> {
    const chain = QUALITY_CHAIN[quality] ?? ['320k', '128k']
    const errBox: { err?: unknown } = {}
    const errMsg = () => (errBox.err instanceof Error ? errBox.err.message : errBox.err ? String(errBox.err) : '')

    if (this.mode === 'manual' && opts?.pinnedProviderId) {
      const p = this.providers.find(x => x.id === opts.pinnedProviderId)
      if (!p) throw new ResolveError('指定音源不存在或未加载', 'manual-blocked')
      const r = await this.tryProvider(p, song, chain, errBox)
      if (r) return r
      throw new ResolveError('锁定音源解析失败：' + errMsg(), 'manual-blocked')
    }

    for (const p of this.providers) {
      if (p.health.status === 'disabled' || !p.resolveUrl) continue
      const r = await this.tryProvider(p, song, chain, errBox)
      if (r) return r
    }

    // 跨平台兜底:本曲所属平台无可用源(如 Q音 tx)时,
    // 按「歌名+歌手」在 GD 搜索同曲,用其它平台的等价音源播放
    try {
      const gd = this.providers.find(x => x.id === 'gd')
      if (gd?.search) {
        const hits = await withTimeout(gd.search(song.name.trim() + ' ' + song.artist.trim(), 1), 12000)
        const norm = (s: string) => s.toLowerCase().replace(/[\s()（）\[\]【】·\-—_,.、!！?？'"“”]/g, '')
        const wantName = norm(song.name)
        const wantArtist = norm(song.artist.split(/[/、,&]/)[0] ?? '')
        const hit = hits.find(h => norm(h.name) === wantName && norm(h.artist).includes(wantArtist.slice(0, 4)))
          ?? hits.find(h => norm(h.name) === wantName)
          ?? hits.find(h => norm(h.name).includes(wantName) || wantName.includes(norm(h.name)))
        if (hit) {
          const r = await this.tryProvider(gd, hit, chain, errBox)
          if (r) return { ...r, crossPlatform: true, note: '跨平台音源(' + hit.origins[0]?.platform + ')' }
        }
      }
    } catch { /* ignore */ }

    throw new ResolveError('所有音源均无法解析' + (errMsg() ? '：' + errMsg() : ''), 'all-failed')
  }

  async getPic(song: Song): Promise<string | undefined> {
    const cached = this.picCache.get(song.key)
    if (cached) return cached
    for (const o of song.origins) {
      const p = this.providers.find(x => x.getPic && x.caps.platforms.includes(o.platform as any) && x.health.status !== 'disabled')
      if (!p?.getPic) continue
      try {
        const url = await withTimeout(p.getPic(o), 8000)
        if (url) { this.picCache.set(song.key, url); return url }
      } catch { /* next */ }
    }
    return undefined
  }

  async getLyric(song: Song): Promise<string | undefined> {
    // 同一平台的所有 provider 依次尝试(lx 源多无歌词能力,须轮到 GD/HTTP 等)
    for (const o of song.origins) {
      for (const p of this.providers) {
        if (!p.getLyric || !p.caps.platforms.includes(o.platform as any) || p.health.status === 'disabled') continue
        try {
          const lrc = await withTimeout(p.getLyric(o), 8000)
          if (lrc && this.lyricMatchesSong(lrc, song) && this.lyricHasTimeline(lrc)) return lrc
        } catch { /* next */ }
      }
    }
    // 跨平台兜底:播放平台无歌词能力(tx 等)时,按「歌名+歌手」在 GD 搜同名曲取词
    try {
      const gd = this.providers.find(x => x.id === 'gd')
      if (gd?.search && gd.getLyric) {
        const hits = await withTimeout(gd.search(song.name.trim() + ' ' + song.artist.trim(), 1), 12000)
        const hit = hits.find(h => h.name.includes(song.name.trim()))
        const o = hit?.origins[0]
        if (o) {
          const lrc = await withTimeout(gd.getLyric(o), 8000)
          if (lrc && this.lyricMatchesSong(lrc, song) && this.lyricHasTimeline(lrc)) return lrc
        }
      }
    } catch { /* ignore */ }
    return undefined
  }

  /** 歌词质量门:歌名非现场版但歌词头部标注 现场/Live → 视为错版,换源 */
  private lyricMatchesSong(raw: string, song: Song): boolean {
    const n = song.name
    if (/现场|演唱会|live/i.test(n)) return true
    const head = raw.split('\n').slice(0, 6).join('\n')
    return !/现场|演唱会|\blive\b/i.test(head)
  }

  /** 至少两条带时间戳的行,否则视为占位/空歌词 */
  private lyricHasTimeline(raw: string): boolean {
    let n = 0
    for (const line of raw.split('\n')) {
      if (/\[[0-9]{1,3}:[0-9]{1,2}/.test(line) && ++n >= 2) return true
    }
    return false
  }
}
