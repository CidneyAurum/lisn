import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './stores/store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { PlayerDock } from './components/PlayerDock'
import { FullPlayer } from './components/FullPlayer'
import { SearchView } from './views/SearchView'
import { DiscoverView } from './views/DiscoverView'
import { PlaylistView } from './views/PlaylistView'
import { DownloadsView } from './views/DownloadsView'
import { LibraryView } from './views/LibraryView'
import { SourceCenterView } from './views/SourceCenterView'
import { SettingsView } from './views/SettingsView'
import { getAudio } from './stores/store'
import { useSongLyrics } from './hooks/useSongLyrics'
import { useLimbusVisible } from './hooks/useLimbusVisible'

export function App(): JSX.Element {
  const view = useStore(s => s.view)
  const toast = useStore(s => s.toast)
  const current = useStore(s => s.current)
  const playing = useStore(s => s.playing)
  const fullPlayer = useStore(s => s.fullPlayer)
  const limbusOnLocal = useLimbusVisible()
  const overlayLyrics = useSongLyrics(limbusOnLocal ? current : null)
  const limbusConfig = useStore(s => (s.settings as any)?.limbus)
  const refreshSources = useStore(s => s.refreshSources)
  const refreshSettings = useStore(s => s.refreshSettings)
  const refreshDownloads = useStore(s => s.refreshDownloads)

  useEffect(() => {
    void refreshSources()
    void refreshSettings()
    void refreshDownloads()
    const offQueue = window.glass.onQueue(items => useStore.setState({ downloads: items }))
    const offTray = window.glass.onTrayControl(action => {
      const st = useStore.getState()
      if (action === 'toggle') void useStore.getState().togglePlay()
      else if (action === 'next') st.playNext()
      else if (action === 'prev') st.playPrev()
    })
    const offSources = window.glass.onSourcesChanged(snap => useStore.setState({ sources: snap }))
    const offPl = window.glass.onPlaylistsChanged(list => useStore.setState({ playlists: list }))
    void useStore.getState().refreshPlaylists()
    return () => { offQueue(); offTray(); offSources(); offPl() }
  }, [refreshSources, refreshSettings, refreshDownloads])

  // 系统媒体会话(SMTC):媒体键 + 系统媒体浮层
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const audio = getAudio()
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => { if (audio.paused && !useStore.getState().loading) void useStore.getState().togglePlay() })
    ms.setActionHandler('pause', () => useStore.getState().pause())
    ms.setActionHandler('previoustrack', () => useStore.getState().playPrev())
    ms.setActionHandler('nexttrack', () => useStore.getState().playNext())
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime })
    return () => {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const) {
        try { ms.setActionHandler(action, null) } catch { /* unsupported action */ }
      }
    }
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = current ? new MediaMetadata({
      title: current.name,
      artist: current.artist,
      album: current.album ?? '',
      artwork: current.picUrl ? [{ src: current.picUrl, sizes: '512x512' }] : []
    }) : null
  }, [current])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  // 桌面歌词悬浮窗:歌词(换歌时)+ 播放进度(节流 60ms)推送到悬浮窗
  useEffect(() => {
    const pushLyrics = () => {
      if (!limbusOnLocal) return
      window.glass.overlayPushLyrics({ lines: overlayLyrics, title: current?.name ?? '', artist: current?.artist ?? '' })
      window.glass.overlayPushPos(getAudio().currentTime)
    }
    pushLyrics()
    const off = window.glass.onOverlayRepush(pushLyrics)
    const offCfg = window.glass.onLimbusConfig((cfg: unknown) => {
      window.glass.overlaySetConfig(cfg)
    })
    return () => { off(); offCfg() }
  }, [current?.key, current?.name, current?.artist, overlayLyrics, limbusOnLocal])
  useEffect(() => {
    if (!limbusOnLocal) return
    const audio = getAudio()
    let last = 0
    let lastPosition = -1
    const onTime = () => {
      // 无真实音源(解析失败/空闲)时不推送,避免 pos=0 持续覆盖
      if (!audio.src || !isFinite(audio.duration) || audio.duration <= 0) return
      const now = Date.now()
      if (now - last > 60 && audio.currentTime !== lastPosition) {
        last = now; lastPosition = audio.currentTime; window.glass.overlayPushPos(audio.currentTime)
      }
    }
    audio.addEventListener('timeupdate', onTime)
    const t = setInterval(onTime, 250) // 暂停时也保底推送
    return () => { audio.removeEventListener('timeupdate', onTime); clearInterval(t) }
  }, [limbusOnLocal])
  useEffect(() => {
    if (limbusConfig) window.glass.overlaySetConfig(limbusConfig)
  }, [limbusConfig])

  // 任务栏/Alt+Tab 显示当前曲
  useEffect(() => {
    document.title = current
      ? (playing ? '▶ ' : '') + current.name + ' - ' + current.artist + ' · 聆 LISN'
      : '聆 LISN — 你的音乐，由此展开'
  }, [current, playing])

  // 键盘控制:空格 播放/暂停,←/→ 快退/快进 5s(输入框聚焦时忽略)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const audio = getAudio()
      if (e.code === 'Space') {
        e.preventDefault()
        void useStore.getState().togglePlay()
      } else if (e.code === 'ArrowLeft') {
        audio.currentTime = Math.max(0, audio.currentTime - 5)
      } else if (e.code === 'ArrowRight') {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="aurora">
        <div className="aurora-blob b1" />
        <div className="aurora-blob b2" />
        <div className="aurora-blob b3" />
      </div>
      <div className="app-shell">
        <TitleBar />
        <div className="body-row">
          <Sidebar />
          <div className="main">
            <div className="view-scroll">
              {/* 视图容器:用 CSS 入场动画替代 framer-motion 的 mode="wait"
                  (后者依赖退出动画完成回调,窗口失焦/后台 rAF 节流时会卡住导致新视图不挂载=黑屏) */}
              <div key={view} className="view-enter">
                  {view === 'discover' && <DiscoverView />}
                  {view === 'playlist' && <PlaylistView />}
                  {view === 'search' && <SearchView />}
                  {view === 'downloads' && <DownloadsView />}
                  {view === 'library' && <LibraryView />}
                  {view === 'sources' && <SourceCenterView />}
                  {view === 'settings' && <SettingsView />}
              </div>
            </div>
          </div>
        </div>
        <PlayerDock />
      </div>
      <AnimatePresence>
        {fullPlayer && current && <FullPlayer />}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
