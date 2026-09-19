import { create } from 'zustand'
import type { Song, DownloadItem, SourcesSnapshot, Settings, LibraryFile, UserPlaylist } from '../types'

export type View = 'discover' | 'search' | 'playlist' | 'downloads' | 'library' | 'sources' | 'settings'

interface PlayerState {
  current: Song | null
  streamUrl: string | null
  playing: boolean
  loading: boolean
  quality: '128k' | '320k' | 'flac'
  resolveInfo: { providerId: string; platform: string; quality: string } | null
  error: string | null
  manualBlocked: Song | null
  pinnedSourceId: string | null
}

interface AppState extends PlayerState {
  view: View
  // 搜索
  keyword: string
  results: Song[]
  searching: boolean
  loadingMore: boolean
  hasMore: boolean
  page: number
  searched: boolean
  // 下载
  downloads: DownloadItem[]
  // 音源
  sources: SourcesSnapshot | null
  // 设置/库
  settings: Settings | null
  library: { dir: string; files: LibraryFile[] } | null
  // 歌单视图：kind=agg 聚合歌单（每日推荐）| kind=custom 自建歌单
  playlist:
    | { kind: 'agg'; title: string; sub: string; keyword: string; songs: Song[] }
    | { kind: 'custom'; id: string }
    | null
  playlists: UserPlaylist[]
  // 播放队列（来自搜索结果）
  queue: Song[]
  queueIdx: number
  // toast
  toast: { id: number; msg: string } | null

  setView: (v: View) => void
  setKeyword: (k: string) => void
  doSearch: (kw?: string) => Promise<void>
  loadMore: () => Promise<void>
  ensurePics: (songs: Song[]) => void
  play: (song: Song, list?: Song[]) => Promise<void>
  playNext: () => void
  playPrev: () => void
  playMode: 'loop' | 'one' | 'shuffle'
  cyclePlayMode: () => void
  sleepTimerAt: number | null
  setSleepTimer: (minutes: number) => void
  setPlaying: (p: boolean) => void
  setQuality: (q: '128k' | '320k' | 'flac') => void
  setPinnedSource: (id: string | null) => void
  clearManualBlocked: () => void
  refreshDownloads: () => Promise<void>
  refreshSources: () => Promise<void>
  refreshSettings: () => Promise<void>
  refreshLibrary: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  showToast: (msg: string) => void
}

// 模块级 <audio> 单例
let audioEl: HTMLAudioElement | null = null
export function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.preload = 'auto'
  }
  return audioEl
}

const picPending = new Set<string>()

export const useStore = create<AppState>((set, get) => ({
  view: 'discover',
  keyword: '',
  results: [],
  searching: false,
  loadingMore: false,
  hasMore: false,
  page: 1,
  searched: false,
  downloads: [],
  sources: null,
  settings: null,
  library: null,
  playlist: null,
  playlists: [],
  queue: [],
  queueIdx: -1,
  toast: null,

  current: null,
  streamUrl: null,
  playing: false,
  loading: false,
  quality: '320k',
  playMode: 'loop',
  sleepTimerAt: null,
  resolveInfo: null,
  error: null,
  manualBlocked: null,
  pinnedSourceId: null,

  setView: (v) => set({ view: v }),
  setKeyword: (k) => set({ keyword: k }),

  doSearch: async (kw) => {
    const keyword = (kw ?? get().keyword).trim()
    if (!keyword || get().searching) return
    set({ searching: true, searched: true, keyword, error: null, results: [], page: 1, hasMore: false })
    try {
      const r = await window.glass.search(keyword, 1)
      set({ results: r.songs, searching: false, hasMore: r.hasMore, page: 1 })
      get().ensurePics(r.songs)
    } catch (e) {
      set({ searching: false, results: [], error: e instanceof Error ? e.message : String(e) })
    }
  },

  loadMore: async () => {
    const st = get()
    if (!st.keyword || st.searching || st.loadingMore || !st.hasMore) return
    set({ loadingMore: true })
    try {
      const r = await window.glass.search(st.keyword, st.page + 1)
      set({ results: r.songs, loadingMore: false, hasMore: r.hasMore, page: r.page })
    } catch (e) {
      set({ loadingMore: false, hasMore: false })
    }
  },

  ensurePics: (songs) => {
    let i = 0
    for (const s of songs.slice(0, 60)) {
      if (s.picUrl || picPending.has(s.key)) continue
      picPending.add(s.key)
      const delay = 120 * (i++)
      setTimeout(async () => {
        try {
          const pic = await window.glass.pic(s)
          if (pic) {
            const { results, queue } = get()
            const patch = (arr: Song[]) => arr.map(x => (x.key === s.key ? { ...x, picUrl: pic } : x))
            set({ results: patch(results), queue: patch(queue) })
            const cur = get().current
            if (cur?.key === s.key) set({ current: { ...cur, picUrl: pic } })
          }
        } catch { /* ignore */ } finally { picPending.delete(s.key) }
      }, delay)
    }
  },

  play: async (song, list) => {
    const st = get()
    const queue = list ?? st.results
    const idx = queue.findIndex(x => x.key === song.key)
    set({
      current: song, playing: false, loading: true, error: null, manualBlocked: null,
      queue, queueIdx: idx >= 0 ? idx : st.queueIdx
    })
    get().ensurePics([song])
    try {
      const res = await window.glass.resolve(song, st.quality, st.pinnedSourceId)
      const audio = getAudio()
      audio.loop = st.playMode === 'one'
      audio.src = res.streamUrl
      await audio.play()
      set({ streamUrl: res.streamUrl, playing: true, loading: false, resolveInfo: { providerId: res.providerId, platform: res.platform, quality: res.quality } })
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (msg.includes('manual-blocked')) {
        set({ loading: false, manualBlocked: song, error: null })
      } else {
        set({ loading: false, playing: false, error: msg })
        get().showToast('解析失败：' + msg.slice(0, 80))
      }
    }
  },

  playNext: () => {
    const { queue, queueIdx, playMode } = get()
    if (!queue.length) return
    let next = (queueIdx + 1) % queue.length
    if (playMode === 'shuffle' && queue.length > 1) {
      while (next === queueIdx) next = Math.floor(Math.random() * queue.length)
    }
    void get().play(queue[next], queue)
  },
  playPrev: () => {
    const { queue, queueIdx, playMode } = get()
    if (!queue.length) return
    let prev = (queueIdx - 1 + queue.length) % queue.length
    if (playMode === 'shuffle' && queue.length > 1) {
      while (prev === queueIdx) prev = Math.floor(Math.random() * queue.length)
    }
    void get().play(queue[prev], queue)
  },

  setSleepTimer: (minutes: number) => {
    const w = window as any
    if (w.__sleepTimer) { clearTimeout(w.__sleepTimer); w.__sleepTimer = null }
    if (minutes > 0) {
      w.__sleepTimer = setTimeout(() => {
        getAudio().pause()
        set({ sleepTimerAt: null })
        const id = Date.now()
        set({ toast: { id, msg: '睡眠时间到,已暂停播放' } })
        setTimeout(() => { if (get().toast?.id === id) set({ toast: null }) }, 3200)
      }, minutes * 60000)
      set({ sleepTimerAt: Date.now() + minutes * 60000 })
    } else {
      set({ sleepTimerAt: null })
    }
  },
  cyclePlayMode: () => {
    const cur = get().playMode
    const next: 'loop' | 'one' | 'shuffle' = cur === 'loop' ? 'shuffle' : cur === 'shuffle' ? 'one' : 'loop'
    set({ playMode: next })
    getAudio().loop = next === 'one'
    const s = get().settings
    if (s) { const nextSettings = { ...s, playMode: next }; set({ settings: nextSettings }); void window.glass.patchSettings({ playMode: next }) }
  },
  setPlaying: (p) => set({ playing: p }),
  setQuality: (q) => {
    set({ quality: q })
    const cur = get().current
    if (cur) void get().play(cur)
  },
  setPinnedSource: (id) => {
    set({ pinnedSourceId: id })
    get().showToast(id ? '已锁定指定音源，解析将只走该源' : '已清除锁定，回到自动竞速')
  },
  clearManualBlocked: () => set({ manualBlocked: null }),

  refreshDownloads: async () => set({ downloads: await window.glass.queue() }),
  refreshSources: async () => set({ sources: await window.glass.sources() }),
  refreshSettings: async () => {
    const s = await window.glass.getSettings()
    set({ settings: s, quality: s.quality, playMode: s.playMode ?? 'loop' })
  },
  refreshLibrary: async () => set({ library: await window.glass.libraryScan() }),
  refreshPlaylists: async () => set({ playlists: await window.glass.plList() }),

  showToast: (msg) => {
    const id = Date.now()
    set({ toast: { id, msg } })
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }) }, 3200)
  }
}))
