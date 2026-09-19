import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, X, Volume2, Repeat, Repeat1, Shuffle, Loader2 } from 'lucide-react'
import { useStore, getAudio } from '../stores/store'
import { parseLrc, currentIndex, type LrcLine } from '../utils/lrc'
import { LimbusPerformance } from './LimbusPerformance'
import { motion } from 'framer-motion'

const fmt = (sec: number) => {
  if (!isFinite(sec) || sec < 0) return '0:00'
  return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0')
}

/** 桌面全屏播放视图:大封面 + 同步歌词 + 完整控制 */
export function FullPlayer(): JSX.Element {
  const current = useStore(s => s.current)
  const playing = useStore(s => s.playing)
  const lyricSize = useStore(s => (s.settings as any)?.lyricSize ?? 16)
  const loading = useStore(s => s.loading)
  const playMode = useStore(s => s.playMode)
  const cyclePlayMode = useStore(s => s.cyclePlayMode)
  const play = useStore(s => s.play)
  const queue = useStore(s => s.queue)
  const playNext = useStore(s => s.playNext)
  const playPrev = useStore(s => s.playPrev)
  const setFullPlayer = useStore(s => s.setFullPlayer)
  const quality = useStore(s => s.quality)
  const refreshSettings = useStore(s => s.refreshSettings)
  const showToast = useStore(s => s.showToast)

  const audio = getAudio()
  const [time, setTime] = useState(audio.currentTime)
  const [dur, setDur] = useState(audio.duration || 0)
  const [volume, setVolume] = useState(audio.volume)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onTime = () => { setTime(audio.currentTime); setDur(audio.duration || 0) }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    function onMeta() { setDur(audio.duration || 0) }
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
    }
  }, [audio])

  const [lrc, setLrc] = useState<LrcLine[]>([])
  const [showLimbus, setShowLimbus] = useState(false)
  useEffect(() => {
    let alive = true
    setLrc([])
    if (current) {
      window.glass.lyric(current).then(raw => {
        if (alive && raw) setLrc(parseLrc(raw))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [current])
  const curIdx = useMemo(() => currentIndex(lrc, time), [lrc, time])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.lrc-line.on')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [curIdx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullPlayer(false)
      if (e.key === 'l' || e.key === 'L') setShowLimbus(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFullPlayer])

  const seek = (e: React.MouseEvent) => {
    if (!barRef.current || !dur) return
    const r = barRef.current.getBoundingClientRect()
    const ratio = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
    audio.currentTime = ratio * dur
    setTime(ratio * dur)
  }

  return (
    <motion.div
      className="full-player"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
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
          <div className="fp-title">{current?.name ?? ''}</div>
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
            <div className="fp-lyrics" ref={listRef} style={{ ['--lrc-size' as any]: lyricSize + 'px' }}>
              {lrc.length ? lrc.map((line, i) => (
                <div key={i} className={'lrc-line' + (i === curIdx ? ' on' : '')}
                  onClick={() => { audio.currentTime = line.timeMs / 1000 }}>
                  {line.text || '···'}
                </div>
              )) : <div className="fp-nolrc">暂无歌词,播放中可尝试切歌获取</div>}
            </div>
          )}
        </div>
      </div>

      <div className="fp-controls">
        <div className="fp-progress" ref={barRef} onClick={seek}>
          <div className="fill" style={{ ['--fill' as any]: (dur ? (time / dur) * 100 : 0) + '%' }} />
        </div>
        <div className="fp-times"><span>{fmt(time)}</span><span>{fmt(dur)}</span></div>
        <div className="fp-btns">
          <button className="fp-btn" onClick={cyclePlayMode} title={playMode === 'loop' ? '列表循环' : playMode === 'shuffle' ? '随机' : '单曲循环'}>
            {playMode === 'one' ? <Repeat1 size={20} /> : playMode === 'shuffle' ? <Shuffle size={20} /> : <Repeat size={20} />}
          </button>
          <button className="fp-btn" onClick={playPrev} title="上一首"><SkipBack size={26} /></button>
          <button className="fp-play" onClick={() => { if (loading) return; playing ? audio.pause() : audio.play() }}>
            {loading ? <Loader2 size={26} className="spin" /> : playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          </button>
          <button className="fp-btn" onClick={playNext} title="下一首"><SkipForward size={26} /></button>
          <div className="fp-vol">
            <Volume2 size={16} color="var(--text-3)" />
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => { const v = Number(e.target.value); setVolume(v); audio.volume = v; localStorage.setItem('lisn-volume', String(v)) }}
              style={{ width: 90, accentColor: '#6e6bff' }} />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
