import { useStore } from '../stores/store'
import { useSongLyrics } from '../hooks/useSongLyrics'
import { LyricLines } from './LyricLines'

/** 底部停靠的同步歌词面板:随播放滚动,点击行跳转 */
export function LyricPanel(): JSX.Element | null {
  const current = useStore(s => s.current)
  const lrc = useSongLyrics(current)
  if (!lrc.length) return null
  return <LyricLines lines={lrc} className="lyric-panel" />
}
