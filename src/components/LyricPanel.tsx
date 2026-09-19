import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getAudio } from '../stores/store'
import { parseLrc, currentIndex, type LrcLine } from '../utils/lrc'

/** 底部停靠的同步歌词面板:随播放滚动,点击行跳转 */
export function LyricPanel(): JSX.Element | null {
  const current = useStore(s => s.current)
  const [lrc, setLrc] = useState<LrcLine[]>([])
  const [time, setTime] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const audio = getAudio()
    const onTime = () => setTime(audio.currentTime)
    audio.addEventListener('timeupdate', onTime)
    return () => audio.removeEventListener('timeupdate', onTime)
  }, [])

  const idx = useMemo(() => currentIndex(lrc, time), [lrc, time])

  useEffect(() => {
    const el = listRef.current?.querySelector('.lrc-line.on') as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [idx])

  if (!lrc.length) return null
  return (
    <div className="lyric-panel" ref={listRef}>
      {lrc.map((line, i) => (
        <div
          key={i}
          className={'lrc-line' + (i === idx ? ' on' : '')}
          onClick={() => { getAudio().currentTime = line.timeMs / 1000 }}
        >
          {line.text || '···'}
        </div>
      ))}
    </div>
  )
}
