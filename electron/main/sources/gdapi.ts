import { SourceProvider, Song, SongOrigin, Platform, UA, markOk, markFail, withTimeout } from './spi'

const BASE = 'https://music-api.gdstudio.xyz/api.php'
// 实测支持的 source 值：netease / kuwo（kugou/qq/migu 返回 400）
const GD_SOURCES: { gd: string; platform: Platform }[] = [
  { gd: 'netease', platform: 'wy' },
  { gd: 'kuwo', platform: 'kw' }
]
const PLATFORM_TO_GD: Record<string, string> = { wy: 'netease', kw: 'kuwo' }

async function gdFetch(params: Record<string, string | number>): Promise<any> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  const res = await fetch(BASE + '?' + qs.toString(), {
    headers: { 'User-Agent': UA, Referer: 'https://music.gdstudio.xyz/' },
    signal: AbortSignal.timeout(12000)
  })
  const text = await res.text()
  if (!res.ok) throw new Error('GD HTTP ' + res.status + ': ' + text.slice(0, 80))
  try { return JSON.parse(text) } catch { return text }
}

interface GdSearchItem {
  id: string; url_id: string; lyric_id: string; pic_id: string
  name: string; artist: string[]; album?: string; source: string
}

export class GdProvider implements SourceProvider {
  id = 'gd'
  name = 'GD音乐台'
  kind = 'gd' as const
  caps = { platforms: ['wy', 'kw'] as Platform[], qualities: ['320k', '128k', 'flac'], supportsSearch: true }
  health = { status: 'loading' as const, okCount: 0, failCount: 0 }

  async search(keyword: string, page = 1): Promise<Song[]> {
    const out: Song[] = []
    await Promise.all(GD_SOURCES.map(async ({ gd, platform }) => {
      try {
        const t0 = Date.now()
        // 实测：count=每页数量(上限75)，pages=页码（pages=1/2 零重叠，真翻页）
        const list = (await withTimeout(gdFetch({ types: 'search', source: gd, name: keyword, count: 75, pages: page }), 15000)) as GdSearchItem[]
        markOk(this, Date.now() - t0)
        for (const it of Array.isArray(list) ? list : []) {
          if (!it?.name || !(it.url_id || it.id)) continue
          const artist = (it.artist ?? []).join('/') || '未知歌手'
          const origin: SongOrigin = {
            providerId: this.id, platform,
            songId: String(it.url_id ?? it.id),
            extra: { picId: it.pic_id, lyricId: it.lyric_id, gdName: it.name }
          }
          out.push({
            key: (it.name + '|' + artist).toLowerCase(),
            name: it.name, artist, album: it.album,
            origins: [origin]
          })
        }
      } catch (e) { markFail(this, e) }
    }))
    return out
  }

  async resolveUrl(origin: SongOrigin, quality: string): Promise<string> {
    const gd = PLATFORM_TO_GD[origin.platform]
    if (!gd) throw new Error('GD 不支持平台 ' + origin.platform)
    const br = quality === '128k' ? 128 : quality === 'flac' ? 999 : 320
    const j = await withTimeout(gdFetch({ types: 'url', source: gd, id: origin.songId, br }), 12000)
    const url = typeof j === 'string' ? j : j?.url
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) throw new Error('GD 无可用 URL')
    return url
  }

  async getPic(origin: SongOrigin): Promise<string | undefined> {
    const picId = (origin.extra as any)?.picId
    if (!picId || !PLATFORM_TO_GD[origin.platform]) return undefined
    try {
      const j = await gdFetch({ types: 'pic', source: PLATFORM_TO_GD[origin.platform], id: String(picId), size: 300 })
      const url = typeof j === 'string' ? j : j?.url
      return typeof url === 'string' && /^https?:/.test(url) ? url : undefined
    } catch { return undefined }
  }

  async getLyric(origin: SongOrigin): Promise<string | undefined> {
    const lyricId = (origin.extra as any)?.lyricId
    if (!lyricId || !PLATFORM_TO_GD[origin.platform]) return undefined
    try {
      const j = await gdFetch({ types: 'lyric', source: PLATFORM_TO_GD[origin.platform], id: String(lyricId) })
      if (typeof j === 'string') return j.startsWith('http') ? undefined : j
      return j?.lyric ?? undefined
    } catch { return undefined }
  }

  async test(): Promise<{ ok: boolean; detail: string }> {
    try {
      const songs = await this.search('晴天')
      return { ok: songs.length > 0, detail: '搜索返回 ' + songs.length + ' 条' }
    } catch (e) { return { ok: false, detail: String(e) } }
  }
}
