import { useEffect, useRef, useState } from 'react'
import { getAudio } from '../stores/store'

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0')
}

/** Progress events update this small subtree instead of the whole player and its dialogs. */
export function PlaybackProgress({ full = false }: { full?: boolean }): JSX.Element {
  const audio = getAudio()
  const bar = useRef<HTMLDivElement>(null)
  const [state, setState] = useState({ time: 0, duration: 0, buffered: 0 })
  useEffect(() => {
    const update = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      let buffered = 0
      try { if (duration && audio.buffered.length) buffered = Math.min(1, audio.buffered.end(audio.buffered.length - 1) / duration) } catch { /* range reset */ }
      const next = { time: audio.currentTime, duration, buffered }
      setState(prev => prev.time === next.time && prev.duration === duration && prev.buffered === buffered ? prev : next)
    }
    const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'progress', 'emptied']
    update()
    events.forEach(event => audio.addEventListener(event, update))
    return () => events.forEach(event => audio.removeEventListener(event, update))
  }, [audio])
  const seek = (event: React.MouseEvent) => {
    if (!bar.current || !state.duration) return
    const rect = bar.current.getBoundingClientRect()
    if (rect.width <= 0) return
    audio.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * state.duration
    setState(prev => ({ ...prev, time: audio.currentTime }))
  }
  const progress = <div className={full ? 'fp-progress' : 'progress'} ref={bar} onClick={seek}>
    {!full && <div className="buf" style={{ ['--buf' as string]: state.buffered * 100 + '%' }} />}
    <div className="fill" style={{ ['--fill' as string]: (state.duration ? state.time / state.duration * 100 : 0) + '%' }} />
  </div>
  return full ? <>{progress}<div className="fp-times"><span>{fmt(state.time)}</span><span>{fmt(state.duration)}</span></div></>
    : <div className="progress-row"><span className="time">{fmt(state.time)}</span>{progress}<span className="time right">{fmt(state.duration)}</span></div>
}
