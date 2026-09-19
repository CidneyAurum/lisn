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
  fullPlayer: boolean
  setFullPlayer: (v: boolean) => void
  searchHistory: string[]
  clearSearchHistory: () => void
  cyclePlayMode: () => void
  sleepTimerAt: number | null
  setSleepTimer: (minutes: number) => void
  setPlaying: (p: boolean) => void
  togglePlay: () => Promise<void>
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
  queue: (() => { try { return JSON.parse(localStorage.getItem('lisn-lastplay') || 'null')?.queue ?? [] } catch { return [] } })(),
  queueIdx: (() => { try { return JSON.parse(localStorage.getItem('lisn-lastplay') || 'null')?.queueIdx ?? -1 } catch { return -1 } })(),
  toast: null,

  current: (() => { try { return JSON.parse(localStorage.getItem('lisn-lastplay') || 'null')?.current ?? null } catch { return null } })(),
  streamUrl: null,
  playing: false,
  loading: false,
  quality: '320k',
  playMode: 'loop',
  fullPlayer: false,
  searchHistory: (() => { try { return JSON.parse(localStorage.getItem('lisn-search-history') || '[]') } catch { return [] } })(),
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
    {
      // 搜索历史:去重置顶,最多 30 条
      const hist = get().searchHistory.filter(h => h !== keyword)
      hist.unshift(keyword)
      const clipped = hist.slice(0, 30)
      set({ searchHistory: clipped })
      try { localStorage.setItem('lisn-search-history', JSON.stringify(clipped)) } catch { /* 配额 */ }
    }
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
      markIntentionalLoad()
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

  setFullPlayer: (v: boolean) => set({ fullPlayer: v }),
  clearSearchHistory: () => {
    set({ searchHistory: [] })
    try { localStorage.removeItem('lisn-search-history') } catch { /* ignore */ }
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
  togglePlay: async () => {
    const audio = getAudio()
    if (!audio.paused) { audio.pause(); return }
    try {
      await audio.play()
    } catch {
      // 流已过期/失效(免费源链接有时效):重新解析并断点续播
      const st = get()
      if (!st.current) return
      const resumeAt = Math.max(0, audio.currentTime)
      get().showToast('播放流已失效,正在重新解析…')
      try {
        const res = await window.glass.resolve(st.current, st.quality, st.pinnedSourceId)
        markIntentionalLoad()
        audio.src = res.streamUrl
        await new Promise<void>(r => {
          const f = () => { audio.removeEventListener('loadedmetadata', f); r() }
          audio.addEventListener('loadedmetadata', f)
          setTimeout(r, 4000)
        })
        try { if (resumeAt > 1) audio.currentTime = resumeAt } catch { /* 流不支持 seek */ }
        await audio.play()
        set({ playing: true, streamUrl: res.streamUrl, resolveInfo: { providerId: res.providerId, platform: res.platform, quality: res.quality } })
        get().showToast('已恢复播放')
      } catch {
        set({ playing: false, error: '恢复播放失败' })
        get().showToast('恢复播放失败,请尝试切下一首')
      }
    }
  },
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

// 队列持久化:重启后保留队列与当前曲(streamUrl 不持久,点播放自动重新解析)
useStore.subscribe((s, p) => {
  if (s.current && (s.current !== p.current || s.queueIdx !== p.queueIdx)) {
    try { localStorage.setItem('lisn-lastplay', JSON.stringify({ queue: s.queue.slice(0, 300), queueIdx: s.queueIdx, current: s.current })) } catch { /* 配额 */ }
  }
})

// 调试/E2E:CDP 可通过 window.__store 驱动与检查应用状态(本地应用,常驻无害)
;(window as any).__store = useStore
;(window as any).__audio = getAudio()
;(window as any).__getAudio = getAudio

// ---- 播放中断自愈:设备切换/流断开/其它应用抢占后,原地重解析并断点续播 ----
let recoverAttempt = 0
let recoverBusy = false
let intentionalLoadUntil = 0
let lastPosSec = 0
let stallStart = 0
let lastPosChangeAt = 0
let stableTimer: ReturnType<typeof setTimeout> | null = null

export function markIntentionalLoad(): void {
  intentionalLoadUntil = Date.now() + 4000
}

/** 诊断上报:写入 userData/lisn.log(排查播放中断现场) */
function diag(msg: string): void {
  try { (window as any).glass?.diag?.('[audio] ' + msg) } catch { /* ignore */ }
}

;(() => {
  const a = getAudio()
  a.addEventListener('timeupdate', () => {
    if (a.currentTime !== lastPosSec) lastPosChangeAt = Date.now()
    lastPosSec = a.currentTime
    stallStart = 0
  })
  const recover = async (reason: string): Promise<void> => {
    const st = useStore.getState()
    if (!st.current || !st.playing) return            // 非主动播放(换歌/暂停/初始失败)不干预
    if (Date.now() < intentionalLoadUntil) return     // 主动换源引起的瞬态事件
    if (recoverBusy) return
    if (recoverAttempt >= 3) {
      recoverAttempt = 0
      useStore.getState().showToast('连续中断,已自动切换下一首')
      useStore.getState().playNext()
      return
    }
    recoverBusy = true
    recoverAttempt++
    const resumeAt = Math.max(0, lastPosSec - 1)
    useStore.getState().showToast(`播放被打断,正在恢复(${recoverAttempt}/3)…`)
    try {
      const res = await window.glass.resolve(st.current, st.quality, st.pinnedSourceId)
      console.log('[自愈] 重解析成功,载入流', res.streamUrl?.slice(0, 60))
      diag('recover#' + recoverAttempt + ' reason=' + reason + ' -> newUrl host=' + String(res.streamUrl).slice(0, 80))
      const audio = getAudio()
      markIntentionalLoad()
      audio.src = res.streamUrl
      await new Promise<void>(resolve => {
        const onMeta = () => { console.log('[自愈] metadata 就绪'); audio.removeEventListener('loadedmetadata', onMeta); resolve() }
        audio.addEventListener('loadedmetadata', onMeta)
        setTimeout(() => { console.log('[自愈] metadata 超时,继续'); resolve() }, 4000)
      })
      try { audio.currentTime = resumeAt; console.log('[自愈] seek 到', resumeAt) } catch (e) { console.log('[自愈] seek 失败', String(e).slice(0, 80)) }
      await audio.play()
      console.log('[自愈] 恢复播放成功')
      diag('recover#' + recoverAttempt + ' OK resumed at ' + audio.currentTime.toFixed(1))
      useStore.setState({ playing: true, loading: false, streamUrl: res.streamUrl, resolveInfo: { providerId: res.providerId, platform: res.platform, quality: res.quality } })
      if (stableTimer) clearTimeout(stableTimer)
      stableTimer = setTimeout(() => { recoverAttempt = 0 }, 30000) // 稳定播 30s 后重置计数
    } catch (e) {
      console.log('[自愈] 恢复失败:', String(e).slice(0, 120))
      diag('recover#' + recoverAttempt + ' FAIL ' + String(e).slice(0, 120))
      setTimeout(() => { recoverBusy = false; void recover(reason + '+') }, 2000)
      return
    }
    recoverBusy = false
  }
  a.addEventListener('waiting', () => diag('waiting pos=' + a.currentTime.toFixed(1) + ' ready=' + a.readyState))
  a.addEventListener('playing', () => diag('playing pos=' + a.currentTime.toFixed(1)))
  a.addEventListener('ended', () => diag('ended'))
  a.addEventListener('emptied', () => diag('emptied'))
  a.addEventListener('error', () => {
    const st = useStore.getState()
    diag('ERROR code=' + (a.error?.code ?? '?') + ' msg=' + (a.error?.message ?? '') + ' pos=' + a.currentTime.toFixed(1) +
      ' ready=' + a.readyState + ' net=' + a.networkState + ' playing=' + st.playing + ' song=' + (st.current?.name ?? '-'))
    if (a.src) void recover('error' + (a.error?.code ?? ''))
  })
  a.addEventListener('abort', () => {
    if (Date.now() < intentionalLoadUntil) return
    const st = useStore.getState()
    if (st.current && st.playing) void recover('abort')
  })
  a.addEventListener('stalled', () => { stallStart = Date.now() })
  // 位置看门狗:播放中位置超过 8s 不前进(流挂起/无事件静默冻结)即判定卡死并自愈
  setInterval(() => {
    if (stallStart && Date.now() - stallStart > 10000) { stallStart = 0; void recover('stalled') }
    const st = useStore.getState()
    if (!st.playing || st.loading) return
    if (a.paused) return
    if (lastPosChangeAt && Date.now() - lastPosChangeAt > 8000) {
      lastPosChangeAt = Date.now() // 防重复触发
      diag('WATCHDOG 位置停滞 >8s pos=' + a.currentTime.toFixed(1) + ' ready=' + a.readyState + ' net=' + a.networkState)
      void recover('watchdog')
    }
  }, 3000)
})()
