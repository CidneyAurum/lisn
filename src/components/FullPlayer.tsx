import { useEffect, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, X, Volume2, Repeat, Repeat1, Shuffle, Loader2, Plus } from 'lucide-react'
import { useStore, getAudio } from '../stores/store'
import { useSongLyrics } from '../hooks/useSongLyrics'
import { LyricLines } from './LyricLines'
import { PlaybackProgress } from './PlaybackProgress'
import { LimbusPerformance } from './LimbusPerformance'
import { AddToPlaylistDialog } from './SongTable'
import { motion, AnimatePresence } from 'framer-motion'

/** 桌面全屏播放视图:大封面 + 同步歌词 + 完整控制 */
export function FullPlayer(): JSX.Element {
  const current = useStore(s => s.current)
  const playing = useStore(s => s.playing)
  const lyricSize = useStore(s => (s.settings as any)?.lyricSize ?? 16)
  const loading = useStore(s => s.loading)
  const playMode = useStore(s => s.playMode)
  const cyclePlayMode = useStore(s => s.cyclePlayMode)
  const playNext = useStore(s => s.playNext)
  const playPrev = useStore(s => s.playPrev)
  const setFullPlayer = useStore(s => s.setFullPlayer)
  const quality = useStore(s => s.quality)

  const audio = getAudio()
  const [volume, setVolume] = useState(audio.volume)
  const lrc = useSongLyrics(current)
  const [showLimbus, setShowLimbus] = useState(false)
  const [plSong, setPlSong] = useState<import('../types').Song | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'Escape') setFullPlayer(false)
      if (e.key === 'l' || e.key === 'L') setShowLimbus(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFullPlayer])

  return (
    <div className="full-player">
      {current?.picUrl && <img className="fp-bg" src={current.picUrl} alt="" />}
      <div className="fp-shade" />

      <button className="fp-close" onClick={() => setFullPlayer(false)} title="退出全屏 (Esc)"><X size={22} /></button>

      <div className="fp-body">
        <div className="fp-cover">
          {current?.picUrl
            ? <img src={current.picUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-lg)' }} />
            : <Play size={64} color="var(--text-3)" />}
        </div>
        <div className="fp-right">
          <div className="fp-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{current?.name ?? ''}</span>
            {current && (
              <button className="fp-limbus-btn" title="加入歌单" onClick={() => setPlSong(current)}>
                <Plus size={13} />
              </button>
            )}
          </div>
          <div className="fp-artist">
            {current?.artist ?? ''}{current?.album ? ' · ' + current.album : ''}
            <button
              className="fp-limbus-btn"
              onClick={async () => {
                const next = Math.max(12, Math.min(30, lyricSize - 2))
                await window.glass.patchSettings({ lyricSize: next } as any)
                await useStore.getState().refreshSettings()
              }}
              title="歌词字号 -"
            >
              A-
            </button>
            <button
              className="fp-limbus-btn"
              onClick={async () => {
                const next = Math.max(12, Math.min(30, lyricSize + 2))
                await window.glass.patchSettings({ lyricSize: next } as any)
                await useStore.getState().refreshSettings()
              }}
              title="歌词字号 +"
            >
              A+
            </button>
            <button
              className={'fp-limbus-btn' + (showLimbus ? ' on' : '')}
              onClick={() => setShowLimbus(v => !v)}
              title="Limbus 演出模式 (L)"
            >
              演出
            </button>
          </div>
          <div
            className="fp-quality"
            style={{ cursor: 'pointer' }}
            title="点击切换音质(下一首生效)"
            onClick={() => {
              const order = ['128k', '320k', 'flac']
              const cur = useStore.getState().quality
              const next = (order as readonly string[])[(order.indexOf(cur) + 1) % order.length] as '128k' | '320k' | 'flac'
              void window.glass.patchSettings({ quality: next }).then(async () => {
                await useStore.getState().refreshSettings()
                useStore.getState().showToast('音质切换为 ' + next.toUpperCase() + ',下一首生效')
              })
            }}
          >
            {quality.toUpperCase()} · {playMode === 'loop' ? '列表循环' : playMode === 'shuffle' ? '随机' : '单曲循环'}
          </div>
          {showLimbus && lrc.length > 0 ? (
            <div className="fp-limbus">
              <LimbusPerformance
                lines={lrc}
                getPositionSec={() => audio.currentTime}
                onSeek={ms => { audio.currentTime = ms / 1000 }}
              />
            </div>
          ) : (
            <LyricLines lines={lrc} className="fp-lyrics" size={lyricSize} />
          )}
        </div>
      </div>

      <div className="fp-controls">
        <PlaybackProgress full />
        <div className="fp-btns">
          <button className="fp-btn" onClick={cyclePlayMode} title={playMode === 'loop' ? '列表循环' : playMode === 'shuffle' ? '随机' : '单曲循环'}>
            {playMode === 'one' ? <Repeat1 size={20} /> : playMode === 'shuffle' ? <Shuffle size={20} /> : <Repeat size={20} />}
          </button>
          <button className="fp-btn" onClick={playPrev} title="上一首"><SkipBack size={26} /></button>
          <button className="fp-play" onClick={() => { if (loading) { useStore.getState().pause(); return }; void useStore.getState().togglePlay() }}>
            {loading ? <Loader2 size={26} className="spin" /> : playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          </button>
          <button className="fp-btn" onClick={playNext} title="下一首"><SkipForward size={26} /></button>
          <div className="fp-vol">
            <Volume2 size={16} color="var(--text-3)" />
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => { const v = Number(e.target.value); setVolume(v); audio.volume = v; localStorage.setItem('lisn-volume', String(v)) }}
              style={{ width: 90, accentColor: '#39c5bb' }} />
          </div>
        </div>
      </div>
      <AnimatePresence>
        {plSong && <AddToPlaylistDialog song={plSong} onClose={() => setPlSong(null)} />}
      </AnimatePresence>
    </div>
  )
}
