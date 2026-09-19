import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Download, Loader2, Pin, PinOff, ListMusic, Volume2, Repeat, Repeat1, Shuffle, AudioLines, MoonStar, Maximize2 } from 'lucide-react'
import { useStore, getAudio } from '../stores/store'
import { motion, AnimatePresence } from 'framer-motion'
import { SourceBadge } from './SourceBadge'
import { LyricPanel } from './LyricPanel'

const QUALITIES = [
  { id: '320k', label: '320K', tip: '320k 极品' },
  { id: '128k', label: '128K', tip: '128k 标准' },
  { id: 'flac', label: 'SQ', tip: 'FLAC 无损' }
] as const

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

export function PlayerDock(): JSX.Element | null {
  const current = useStore(s => s.current)
  const playing = useStore(s => s.playing)
  const loading = useStore(s => s.loading)
  const quality = useStore(s => s.quality)
  const setQuality = useStore(s => s.setQuality)
  const resolveInfo = useStore(s => s.resolveInfo)
  const pinnedSourceId = useStore(s => s.pinnedSourceId)
  const setPinnedSource = useStore(s => s.setPinnedSource)
  const sources = useStore(s => s.sources)
  const play = useStore(s => s.play)
  const queue = useStore(s => s.queue)
  const queueIdx = useStore(s => s.queueIdx)
  const playNext = useStore(s => s.playNext)
  const playPrev = useStore(s => s.playPrev)
  const playMode = useStore(s => s.playMode)
  const cyclePlayMode = useStore(s => s.cyclePlayMode)
  const sleepTimerAt = useStore(s => s.sleepTimerAt)
  const setSleepTimer = useStore(s => s.setSleepTimer)
  const setFullPlayer = useStore(s => s.setFullPlayer)
  const manualBlocked = useStore(s => s.manualBlocked)
  const clearManualBlocked = useStore(s => s.clearManualBlocked)
  const showToast = useStore(s => s.showToast)

  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [bufRatio, setBufRatio] = useState(0)
  const [volume, setVolume] = useState(() => {
    const v = Number(localStorage.getItem('lisn-volume'))
    return isNaN(v) ? 0.85 : Math.min(Math.max(v, 0), 1)
  })
  const [showQuality, setShowQuality] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [showLyric, setShowLyric] = useState(false)
  const [showSleep, setShowSleep] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const audio = getAudio()
    const onTime = () => setTime(audio.currentTime)
    const onMeta = () => setDur(audio.duration)
    const onProg = () => {
      try {
        if (audio.duration && audio.buffered.length) {
          setBufRatio(audio.buffered.end(audio.buffered.length - 1) / audio.duration)
        }
      } catch { /* ignore */ }
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('progress', onProg)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('progress', onProg)
    }
  }, [])

  useEffect(() => {
    getAudio().volume = volume
    localStorage.setItem('lisn-volume', String(volume))
  }, [volume])

  if (!current && !loading) return <div style={{ height: 'var(--dock-h)' }} />

  const audio = getAudio()

  const seek = (e: React.MouseEvent) => {
    if (!barRef.current || !dur) return
    const rect = barRef.current.getBoundingClientRect()
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    audio.currentTime = ratio * dur
    setTime(ratio * dur)
  }

  const doDownload = async () => {
    if (!current) return
    await window.glass.enqueue(current, quality)
    showToast('已加入下载队列（' + current.name + ' · ' + quality.toUpperCase() + '）')
  }

  const resolvableProviders = (sources?.providers ?? []).filter(p => p.health.status === 'ok')
  const qLabel = QUALITIES.find(q => q.id === quality)?.label ?? quality

  return (
    <>
      {showLyric && <LyricPanel />}
      <div className="dock glass-dock">
      {/* 左：封面 + 歌名/歌手 + 音质徽章（网易云式） */}
      <div className="dock-track">
        <div className={'dock-cover' + (playing ? ' breathing' : '')}>
          {current?.picUrl ? <img src={current.picUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Play size={18} />}
        </div>
        <div className="dock-meta">
          <div className="dock-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current?.name ?? '解析中…'}</span>
            <span className="src-badge" style={{ fontSize: 9.5, padding: '1px 7px' }}>{qLabel}</span>
          </div>
          <div className="dock-artist">{current?.artist ?? ''}</div>
          <div className="dock-src">
            {resolveInfo && <SourceBadge platform={resolveInfo.platform} text={resolveInfo.quality} />}
          </div>
        </div>
      </div>

      {/* 中：控制 + 进度（时间在进度条两端） */}
      <div className="dock-center">
        <div className="dock-controls">
          <button
            className="ctrl-btn"
            onClick={cyclePlayMode}
            title={playMode === 'loop' ? '列表循环' : playMode === 'shuffle' ? '随机播放' : '单曲循环'}
            style={playMode !== 'loop' ? { color: '#7fd8ff' } : {}}
          >
            {playMode === 'one' ? <Repeat1 size={17} /> : playMode === 'shuffle' ? <Shuffle size={17} /> : <Repeat size={17} />}
          </button>
          <button className="ctrl-btn" onClick={playPrev} title="上一首"><SkipBack size={19} /></button>
          <button className="play-btn" onClick={() => {
            if (loading) return
            const st = useStore.getState()
            if (!playing && !audio.src && st.current) { void st.play(st.current, st.queue); return }
            playing ? audio.pause() : audio.play()
          }}>
            {loading ? <Loader2 size={19} className="spin" /> : playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button className="ctrl-btn" onClick={playNext} title="下一首"><SkipForward size={19} /></button>
        </div>
        <div className="progress-row">
          <span className="time">{fmt(time)}</span>
          <div className="progress" ref={barRef} onClick={seek}>
            <div className="buf" style={{ ['--buf' as any]: Math.min(bufRatio * 100, 100) + '%' }} />
            <div className="fill" style={{ ['--fill' as any]: (dur ? (time / dur) * 100 : 0) + '%' }} />
          </div>
          <span className="time right">{fmt(dur)}</span>
        </div>
      </div>

      {/* 右：音量 / 音质 / 锁定源 / 下载 / 队列 */}
      <div className="dock-right">
        <div className="quality-menu">
          <button className="icon-btn" title="播放队列" onClick={() => { setShowQueue(v => !v); setShowQuality(false); setShowPin(false); setShowSleep(false) }}>
            <ListMusic size={17} />
          </button>
          <AnimatePresence>
            {showQueue && (
              <motion.div className="queue-pop" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
                <div className="q-head">当前播放（{queue.length}）</div>
                {queue.map((s, i) => (
                  <button key={s.key} className={'queue-item' + (i === queueIdx ? ' on' : '')} onClick={() => { void play(s, queue); }}>
                    <span className="qi-idx">{i === queueIdx ? '♪' : String(i + 1).padStart(2, '0')}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="qi-name">{s.name}</div>
                      <div className="qi-artist">{s.artist}</div>
                    </div>
                  </button>
                ))}
                {!queue.length && <div className="muted" style={{ padding: '14px', fontSize: 12 }}>队列空</div>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 音量 */}
        <div className="quality-menu" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Volume2 size={15} color="var(--text-3)" />
          <input
            type="range" min={0} max={1} step={0.01} value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            style={{ width: 74, accentColor: '#6e6bff', cursor: 'pointer' }}
          />
        </div>

        {/* 音质 */}
        <div className="quality-menu">
          <button className="q-pill" onClick={() => { setShowQuality(v => !v); setShowPin(false); setShowQueue(false) }}>
            {qLabel}
          </button>
          <AnimatePresence>
            {showQuality && (
              <motion.div className="q-pop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
                {QUALITIES.map(q => (
                  <button key={q.id} className={'q-opt' + (quality === q.id ? ' on' : '')} onClick={() => { setQuality(q.id); setShowQuality(false) }}>
                    {q.tip}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 锁定源 */}
        <div className="quality-menu">
          <button className={'icon-btn' + (pinnedSourceId ? '' : '')} title="锁定解析音源" style={pinnedSourceId ? { color: '#7fd8ff' } : {}} onClick={() => { setShowPin(v => !v); setShowQuality(false); setShowQueue(false) }}>
            {pinnedSourceId ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
          <AnimatePresence>
            {showPin && (
              <motion.div className="pin-pop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-3)' }}>
                  锁定后解析只走该音源（{sources?.mode === 'manual' ? '手动模式' : '自动模式'}）
                </div>
                <button className="q-opt" onClick={() => { setPinnedSource(null); setShowPin(false) }}>
                  <span>自动竞速（清除锁定）</span>
                </button>
                {resolvableProviders.map(p => (
                  <button key={p.id} className={'q-opt' + (pinnedSourceId === p.id ? ' on' : '')} onClick={() => { setPinnedSource(p.id); setShowPin(false) }}>
                    <span>{p.name}</span>
                    <span style={{ fontSize: 10 }}>{p.health.latencyMs ? p.health.latencyMs + 'ms' : ''}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          className={'icon-btn' + (showLyric ? ' on' : '')}
          title="同步歌词"
          onClick={() => { setShowLyric(v => !v); setShowQueue(false); setShowQuality(false); setShowPin(false); setShowSleep(false) }}
        >
          <AudioLines size={17} />
        </button>
        <div className="quality-menu">
          <button
            className="icon-btn"
            title="睡眠定时"
            style={sleepTimerAt ? { color: '#7fd8ff' } : {}}
            onClick={() => { setShowSleep(v => !v); setShowQueue(false); setShowQuality(false); setShowPin(false); setShowLyric(false) }}
          >
            <MoonStar size={16} />
          </button>
          <AnimatePresence>
            {showSleep && (
              <motion.div className="q-pop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-3)' }}>
                  {sleepTimerAt ? '定时中,到点自动暂停' : '播放将在选定时间后暂停'}
                </div>
                {[15, 30, 60].map(m => (
                  <button key={m} className="q-opt" onClick={() => { setSleepTimer(m); setShowSleep(false) }}>
                    <span>{m} 分钟</span>
                  </button>
                ))}
                <button className="q-opt" onClick={() => { setSleepTimer(0); setShowSleep(false) }}>
                  <span style={{ color: 'var(--danger)' }}>取消定时</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button className="icon-btn" onClick={doDownload} title={'下载 ' + quality.toUpperCase()}>
          <Download size={17} />
        </button>
        <button className="icon-btn" title="全屏播放" onClick={() => setFullPlayer(true)}>
          <Maximize2 size={16} />
        </button>
      </div>

      <AnimatePresence>
        {manualBlocked && (
          <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span>锁定音源解析失败，是否切回自动竞速？</span>
            <button className="mini-btn primary" onClick={() => { setPinnedSource(null); void play(manualBlocked) }}>切回自动</button>
            <button className="mini-btn" onClick={clearManualBlocked}>保持锁定</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  )
}
