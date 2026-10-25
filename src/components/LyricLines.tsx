import { memo, useEffect, useRef, useState } from 'react'
import { getAudio } from '../stores/store'
import { currentIndex, type LrcLine } from '../utils/lrc'

const LyricRow = memo(function LyricRow({ line, active }: { line: LrcLine; active: boolean }) {
  return <div className={'lrc-line' + (active ? ' on' : '')}
    onClick={() => { getAudio().currentTime = line.timeMs / 1000 }}>{line.text || '···'}</div>
})

/** Audio progress only changes React state when the highlighted lyric line changes. */
export const LyricLines = memo(function LyricLines({ lines, className, size }: {
  lines: LrcLine[]; className: string; size?: number
}) {
  const [index, setIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const audio = getAudio()
    const update = () => setIndex(currentIndex(lines, audio.currentTime))
    update()
    audio.addEventListener('timeupdate', update)
    audio.addEventListener('seeked', update)
    return () => { audio.removeEventListener('timeupdate', update); audio.removeEventListener('seeked', update) }
  }, [lines])
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('.lrc-line.on')
    if (list && active) list.scrollTo({
      top: list.scrollTop + active.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - active.clientHeight) / 2,
      behavior: 'smooth'
    })
  }, [index, lines])
  return <div className={className} ref={listRef} style={size ? { ['--lrc-size' as string]: size + 'px' } : undefined}>
    {lines.length ? lines.map((line, i) => <LyricRow key={i} line={line} active={i === index} />)
      : <div className="fp-nolrc">暂无歌词,播放中可尝试切歌获取</div>}
  </div>
})
