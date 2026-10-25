import type { Song } from '../types'

/** A new intent cancels every pending step belonging to the previous intent. */
export class LatestRequest {
  private controller = new AbortController()

  get signal(): AbortSignal { return this.controller.signal }
  begin(): AbortSignal {
    this.controller.abort()
    this.controller = new AbortController()
    return this.controller.signal
  }
  cancel(): void { this.controller.abort() }
  isCurrent(signal: AbortSignal): boolean { return signal === this.signal && !signal.aborted }
}

/** Draw once from the other n - 1 entries; no retry loop or sequential bias. */
export function queueIndex(length: number, current: number, direction: 1 | -1, shuffle: boolean, random = Math.random): number {
  if (length <= 0) return -1
  if (current < 0 || current >= length) return direction === 1 ? 0 : length - 1
  if (!shuffle || length === 1) return (current + direction + length) % length
  const draw = Math.min(length - 2, Math.max(0, Math.floor(random() * (length - 1))))
  return draw >= current ? draw + 1 : draw
}

/** Keep accumulated pages local to their search, without losing fetched artwork. */
export function mergeSearchPage(previous: Song[], incoming: Song[]): Song[] {
  const songs = previous.slice()
  const indices = new Map(songs.map((song, index) => [song.key, index]))
  for (const song of incoming) {
    const index = indices.get(song.key)
    if (index === undefined) {
      indices.set(song.key, songs.length)
      songs.push(song)
      continue
    }
    const old = songs[index]
    const origins = old.origins.slice()
    const known = new Set(origins.map(origin => origin.platform + ':' + origin.songId))
    for (const origin of song.origins) {
      const id = origin.platform + ':' + origin.songId
      if (!known.has(id)) { known.add(id); origins.push(origin) }
    }
    if (origins.length !== old.origins.length || (!old.picUrl && song.picUrl) || (!old.album && song.album)) {
      songs[index] = { ...old, origins, picUrl: old.picUrl || song.picUrl, album: old.album || song.album }
    }
  }
  return songs
}

/** Preserve array and song identity when a late artwork batch changes nothing. */
export function applySongCovers(songs: Song[], covers: ReadonlyMap<string, string>): Song[] {
  let result = songs
  songs.forEach((song, index) => {
    const picUrl = covers.get(song.key)
    if (!picUrl || song.picUrl) return
    if (result === songs) result = songs.slice()
    result[index] = { ...song, picUrl }
  })
  return result
}

/** Register before assigning src, and release listeners on every exit path. */
export function waitForMetadata(audio: HTMLAudioElement, signal: AbortSignal, timeoutMs = 4000): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onMetadata)
      audio.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
      resolve(ready)
    }
    const onMetadata = () => finish(true)
    const onError = () => finish(false)
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(true), timeoutMs)
    audio.addEventListener('loadedmetadata', onMetadata)
    audio.addEventListener('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
