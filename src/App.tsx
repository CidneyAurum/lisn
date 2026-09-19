import { useEffect, useRef, useState } from 'react'
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
import { parseLrc } from './utils/lrc'

export function App(): JSX.Element {
  const view = useStore(s => s.view)
  const toast = useStore(s => s.toast)
  const current = useStore(s => s.current)
  const playing = useStore(s => s.playing)
  const fullPlayer = useStore(s => s.fullPlayer)
  const [limbusOnLocal, setLimbusOnLocal] = useState(false)
  const refreshSources = useStore(s => s.refreshSources)
  const refreshSettings = useStore(s => s.refreshSettings)
  const refreshDownloads = useStore(s => s.refreshDownloads)
  const setPlaying = useStore(s => s.setPlaying)
  const playNext = useStore(s => s.playNext)
  const audioBound = useRef(false)

  useEffect(() => {
    void refreshSources()
    void refreshSettings()
    void refreshDownloads()
    const offQueue = window.glass.onQueue(items => useStore.setState({ downloads: items }))
    const offTray = window.glass.onTrayControl(action => {
      const audio = getAudio()
      const st = useStore.getState()
      if (action === 'toggle') audio.paused ? void audio.play().catch(() => {}) : audio.pause()
      else if (action === 'next') st.playNext()
      else if (action === 'prev') st.playPrev()
    })
    const offSources = window.glass.onSourcesChanged(snap => useStore.setState({ sources: snap }))
    const offPl = window.glass.onPlaylistsChanged(list => useStore.setState({ playlists: list }))
    void useStore.getState().refreshPlaylists()
    return () => { offQueue(); offTray(); offSources(); offPl() }
  }, [refreshSources, refreshSettings, refreshDownloads])

  // 全局 audio 事件绑定（单例）
  useEffect(() => {
    if (audioBound.current) return
    audioBound.current = true
    const audio = getAudio()
    audio.addEventListener('play', () => setPlaying(true))
    audio.addEventListener('pause', () => setPlaying(false))
    audio.addEventListener('ended', () => playNext())
    audio.addEventListener('error', () => { if (audio.src) setPlaying(false) })
    // 恢复上次的音量
    const saved = Number(localStorage.getItem('lisn-volume'))
    if (!isNaN(saved) && saved >= 0 && saved <= 1) audio.volume = saved
  }, [setPlaying, playNext])

  // 系统媒体会话(SMTC):媒体键 + 系统媒体浮层
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const audio = getAudio()
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => { void audio.play().catch(() => {}) })
    ms.setActionHandler('pause', () => audio.pause())
    ms.setActionHandler('previoustrack', () => useStore.getState().playPrev())
    ms.setActionHandler('nexttrack', () => useStore.getState().playNext())
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime })
    return () => { try { ms.setActionHandler('play', null); ms.setActionHandler('pause', null) } catch { /* noop */ } }
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

  // 桌面歌词悬浮窗:歌词(换歌时)+ 播放进度(节流 250ms)推送到悬浮窗
  useEffect(() => {
    if (!current) return
    window.glass.lyric(current).then(raw => {
      if (!raw) return
      window.glass.overlayPushLyrics({
        lines: parseLrc(raw).map(l => ({ timeMs: l.timeMs, text: l.text })),
        title: current.name, artist: current.artist
      })
    }).catch(() => {})
  }, [current])
  useEffect(() => {
    const audio = getAudio()
    let last = 0
    const onTime = () => {
      const now = Date.now()
      if (now - last > 250) { last = now; window.glass.overlayPushPos(audio.currentTime) }
    }
    audio.addEventListener('timeupdate', onTime)
    return () => audio.removeEventListener('timeupdate', onTime)
  }, [])
  useEffect(() => {
    const off = window.glass.onLimbusState(v => setLimbusOnLocal(v))
    return off
  }, [])

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
        audio.paused ? void audio.play().catch(() => {}) : audio.pause()
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
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
                >
                  {view === 'discover' && <DiscoverView />}
                  {view === 'playlist' && <PlaylistView />}
                  {view === 'search' && <SearchView />}
                  {view === 'downloads' && <DownloadsView />}
                  {view === 'library' && <LibraryView />}
                  {view === 'sources' && <SourceCenterView />}
                  {view === 'settings' && <SettingsView />}
                </motion.div>
              </AnimatePresence>
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
