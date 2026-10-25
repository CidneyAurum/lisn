import { useEffect, useRef, useState } from 'react'
import type { Song } from '../types'
import { parseLrc, type LrcLine } from '../utils/lrc'

const EMPTY: LrcLine[] = []

/** Cover updates do not reload lyrics; old song responses never replace the new song. */
export function useSongLyrics(song: Song | null): LrcLine[] {
  const songRef = useRef(song)
  songRef.current = song
  const key = song?.key
  const [result, setResult] = useState<{ key?: string; lines: LrcLine[] }>({ lines: EMPTY })

  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    setResult({ key, lines: EMPTY })
    const load = async () => {
      const current = songRef.current
      if (!current || current.key !== key) return
      if (!current.key.startsWith('local:') && !current.origins.length) return
      let lines = EMPTY
      try {
        const raw = await window.glass.lyric(current)
        if (raw) lines = parseLrc(raw)
      } catch { /* Sources can finish loading after the player opens. */ }
      if (!alive) return
      setResult({ key, lines })
      if (!lines.length) retry = setTimeout(() => { void load() }, 30_000)
    }
    void load()
    return () => { alive = false; clearTimeout(retry) }
  }, [key])

  return result.key === key ? result.lines : EMPTY
}
