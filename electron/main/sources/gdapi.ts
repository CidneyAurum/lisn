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
      const raw = j?.lyric ?? undefined
      if (!raw) return undefined
      // 外语歌优先中文翻译:GD 返回 tlyric 时按时间就近替换行文本
      const tlyric = typeof j?.tlyric === 'string' ? j.tlyric : ''
      if (tlyric && isForeignLyric(raw)) return mergeTranslation(raw, tlyric)
      return raw
    } catch { return undefined }
  }

  async test(): Promise<{ ok: boolean; detail: string }> {
    try {
      const songs = await this.search('晴天')
      return { ok: songs.length > 0, detail: '搜索返回 ' + songs.length + ' 条' }
    } catch (e) { return { ok: false, detail: String(e) } }
  }
}


/** 外语判定:含日语假名/韩语谚文即外语;拉丁字母占比 > 0.7 视为外语 */
export function isForeignLyric(lrc: string): boolean {
  const lines = lrc.split('\n')
    .map(l => l.replace(/^\[[^\]]*\]/, '').trim())
    .filter(t => t && !/^[^\s:：]{1,6}[：:]/.test(t) && !/作词|作曲|编曲|制作|翻译/.test(t))
    .slice(0, 10)
  const sample = lines.join(' ')
  if (!sample) return false
  if (/[ぁ-んァ-ヶ]/.test(sample)) return true
  if (/[가-힣]/.test(sample)) return true
  let latin = 0
  let total = 0
  for (const ch of sample) {
    if (/[a-zA-Z]/.test(ch)) latin++
    const o = ch.codePointAt(0)!
    if (o >= 0x4e00 && o <= 0x9fff) total++
  }
  return latin + total > 0 && latin / (latin + total) > 0.7
}

/** 按译文时间戳(±200ms 就近)替换原文行文本,时间轴保持原文 */
export function mergeTranslation(origLrc: string, tlyric: string): string {
  const parseMs = (m: RegExpMatchArray) =>
    (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +String(m[3]).padEnd(3, '0').slice(0, 3) : 0)
  const tmap: Array<{ ms: number; text: string }> = []
  for (const line of tlyric.split('\n')) {
    const m = line.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/)
    if (!m) continue
    const text = line.replace(/^\[[^\]]*\]/, '').trim()
    if (text) tmap.push({ ms: parseMs(m as unknown as RegExpMatchArray), text })
  }
  if (!tmap.length) return origLrc
  return origLrc.split('\n').map(line => {
    const m = line.match(/^(\[[^\]]*\])/)
    const tm = line.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/)
    if (!m || !tm) return line
    const ms = parseMs(tm as unknown as RegExpMatchArray)
    let best: { ms: number; text: string } | null = null
    for (const t of tmap) {
      if (Math.abs(t.ms - ms) <= 200 && (!best || Math.abs(t.ms - ms) < Math.abs(best.ms - ms))) best = t
    }
    return best ? m[1] + best.text : line
  }).join('\n')
}
