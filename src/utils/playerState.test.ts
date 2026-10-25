import assert from 'node:assert/strict'
import { after, before, beforeEach, mock, test } from 'node:test'
import type { GlassApi, SearchPage, Song } from '../types'
import { LatestRequest, applySongCovers, mergeSearchPage, queueIndex, waitForMetadata } from './playerState'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function song(key: string, picUrl: string | undefined = 'cover:' + key): Song {
  return { key, name: key, artist: 'artist', picUrl, origins: [{ providerId: 'gd', platform: 'wy', songId: key }] }
}
function page(songs: Song[], page = 1): SearchPage { return { songs, hasMore: true, page } }
function stream(key: string) { return { url: key, streamUrl: 'stream:' + key, providerId: 'gd', platform: 'wy', quality: '320k' } }
async function settle(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve() }

class FakeAudio extends EventTarget {
  preload = ''
  paused = true
  loop = false
  duration = 180
  currentTime = 0
  readyState = 4
  networkState = 1
  error: { code: number; message: string } | null = null
  playCalls = 0
  nextPlay: Promise<void> | null = null
  private source = ''
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  get src(): string { return this.source }
  set src(value: string) { this.source = value; this.currentTime = 0; this.error = null; this.paused = true }
  async play(): Promise<void> {
    this.playCalls++
    const pending = this.nextPlay
    this.nextPlay = null
    this.paused = false
    this.dispatchEvent(new Event('play'))
    if (pending) await pending
  }
  pause(): void {
    if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')) }
  }
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (listener) {
      const entries = this.listeners.get(type) ?? new Set()
      entries.add(listener)
      this.listeners.set(type, entries)
    }
    super.addEventListener(type, listener, options)
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (listener) this.listeners.get(type)?.delete(listener)
    super.removeEventListener(type, listener, options)
  }
}

let useStore: typeof import('../stores/store').useStore
let audio: FakeAudio
let api: GlassApi
let storageWrites = 0

before(async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const storage = new Map<string, string>()
  Object.assign(globalThis, {
    Audio: FakeAudio,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storageWrites++; storage.set(key, value) },
      removeItem: (key: string) => storage.delete(key)
    },
    window: { glass: {} }
  })
  const module = await import('../stores/store')
  useStore = module.useStore
  audio = module.getAudio() as unknown as FakeAudio
  api = window.glass
})

beforeEach(() => {
  useStore.getState().pause()
  audio.src = ''
  audio.playCalls = 0
  audio.nextPlay = null
  Object.assign(api, {
    search: async () => page([]),
    resolve: async (item: Song) => stream(item.key),
    localStreamUrl: async (path: string) => 'local:' + path,
    pic: async () => undefined,
    patchSettings: async () => ({}),
    diag: () => {}
  })
  useStore.setState({
    current: null, queue: [], queueIdx: -1, results: [], keyword: '', page: 1,
    searching: false, loadingMore: false, hasMore: false, searched: false,
    quality: '320k', playMode: 'loop', settings: null, playing: false, loading: false,
    streamUrl: null, error: null, toast: null, searchHistory: []
  })
  storageWrites = 0
})

after(() => { useStore.getState().pause(); mock.timers.reset() })

test('shuffle reaches every other entry and never falls back to the next track', () => {
  assert.deepEqual([0, 0.25, 0.5, 0.999].map(value => queueIndex(5, 2, 1, true, () => value)), [0, 1, 3, 4])
  assert.equal(queueIndex(5, 1, -1, true, () => 0.999), 4)
  assert.equal(queueIndex(5, 4, 1, false), 0)
  assert.equal(queueIndex(5, 0, -1, false), 4)
  assert.equal(queueIndex(1, 0, 1, true), 0)
  assert.equal(queueIndex(0, -1, 1, true), -1)
})

test('a new request or cancellation invalidates older asynchronous work', () => {
  const request = new LatestRequest()
  const old = request.begin()
  const current = request.begin()
  assert.equal(old.aborted, true)
  assert.equal(request.isCurrent(old), false)
  assert.equal(request.isCurrent(current), true)
  request.cancel()
  assert.equal(request.isCurrent(current), false)
})

test('page merge preserves artwork and combines origins without mutating earlier pages', () => {
  const first = song('first')
  const duplicate = { ...first, picUrl: undefined, origins: [...first.origins, { providerId: 'mf', platform: 'kw', songId: 'other-id' }] }
  const merged = mergeSearchPage([first], [duplicate, song('second')])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].picUrl, first.picUrl)
  assert.equal(merged[0].origins.length, 2)
  assert.equal(first.origins.length, 1)
})

test('irrelevant or already known artwork preserves array identity', () => {
  const covered = [song('first')]
  assert.equal(applySongCovers(covered, new Map([['other', 'other-cover']])), covered)
  assert.equal(applySongCovers(covered, new Map([['first', 'replacement']])), covered)
  const uncovered = [{ ...song('first'), picUrl: undefined }]
  const patched = applySongCovers(uncovered, new Map([['first', 'cover']]))
  assert.notEqual(patched, uncovered)
  assert.equal(uncovered[0].picUrl, undefined)
  assert.equal(patched[0].picUrl, 'cover')
})

test('metadata waits release their listeners when cancelled or timed out', async () => {
  const target = new FakeAudio()
  const request = new AbortController()
  const cancelled = waitForMetadata(target as unknown as HTMLAudioElement, request.signal)
  assert.equal(target.listeners.get('loadedmetadata')?.size, 1)
  request.abort()
  assert.equal(await cancelled, false)
  assert.equal(target.listeners.get('loadedmetadata')?.size, 0)
  assert.equal(target.listeners.get('error')?.size, 0)
  const timed = waitForMetadata(target as unknown as HTMLAudioElement, new AbortController().signal, 100)
  mock.timers.tick(100)
  assert.equal(await timed, true)
  assert.equal(target.listeners.get('loadedmetadata')?.size, 0)
})

test('a new search can start immediately and an older response cannot replace it', async () => {
  const old = deferred<SearchPage>()
  const latest = deferred<SearchPage>()
  api.search = keyword => keyword === 'old' ? old.promise : latest.promise
  const oldSearch = useStore.getState().doSearch('old')
  const latestSearch = useStore.getState().doSearch('latest')
  latest.resolve(page([song('latest')]))
  await latestSearch
  old.resolve(page([song('old')]))
  await oldSearch
  assert.equal(useStore.getState().keyword, 'latest')
  assert.deepEqual(useStore.getState().results.map(item => item.key), ['latest'])
  assert.equal(useStore.getState().searching, false)
})

test('an obsolete page cannot overwrite the next search or its loading flags', async () => {
  const oldPage = deferred<SearchPage>()
  const latest = deferred<SearchPage>()
  useStore.setState({ keyword: 'old', results: [song('old')], hasMore: true })
  api.search = keyword => keyword === 'old' ? oldPage.promise : latest.promise
  const loading = useStore.getState().loadMore()
  const searching = useStore.getState().doSearch('latest')
  oldPage.resolve(page([song('old-page')], 2))
  await loading
  assert.equal(useStore.getState().searching, true)
  assert.equal(useStore.getState().loadingMore, false)
  assert.deepEqual(useStore.getState().results, [])
  latest.resolve(page([song('latest')]))
  await searching
  assert.equal(useStore.getState().page, 1)
})

test('loadMore accumulates stateless backend pages and retains fetched artwork', async () => {
  const first = song('first')
  useStore.setState({ keyword: 'query', results: [first], hasMore: true })
  api.search = async () => page([{ ...first, picUrl: undefined }, song('second')], 2)
  await useStore.getState().loadMore()
  assert.deepEqual(useStore.getState().results.map(item => item.key), ['first', 'second'])
  assert.equal(useStore.getState().results[0].picUrl, first.picUrl)
})

test('a local play supersedes a pending online resolution', async () => {
  const old = deferred<Awaited<ReturnType<GlassApi['resolve']>>>()
  api.resolve = () => old.promise
  const online = useStore.getState().play(song('old'))
  await useStore.getState().playLocalFile('D:/music/local.mp3', 'local', 'artist')
  old.resolve(stream('old'))
  await online
  assert.equal(useStore.getState().current?.key, 'local:D:/music/local.mp3')
  assert.equal(audio.src, 'local:D:/music/local.mp3')
  assert.equal(audio.playCalls, 1)
})

test('an online play supersedes a pending local URL request', async () => {
  const old = deferred<string>()
  api.localStreamUrl = () => old.promise
  const local = useStore.getState().playLocalFile('D:/music/old.mp3', 'old', 'artist')
  await useStore.getState().play(song('latest'))
  old.resolve('local:old')
  await local
  assert.equal(audio.src, 'stream:latest')
  assert.equal(useStore.getState().current?.key, 'latest')
})

test('pause cancels a pending resolution before it can start audio', async () => {
  const pending = deferred<Awaited<ReturnType<GlassApi['resolve']>>>()
  api.resolve = () => pending.promise
  const playing = useStore.getState().play(song('pending'))
  useStore.getState().pause()
  pending.resolve(stream('pending'))
  await playing
  assert.equal(audio.playCalls, 0)
  assert.equal(useStore.getState().playing, false)
  assert.equal(useStore.getState().loading, false)
})

test('an old play promise failing after a track switch leaves the new track playing', async () => {
  const pending = deferred<void>()
  audio.nextPlay = pending.promise
  const old = useStore.getState().play(song('old'))
  await settle()
  await useStore.getState().play(song('latest'))
  pending.reject(new DOMException('interrupted by a new load request', 'AbortError'))
  await old
  assert.equal(audio.src, 'stream:latest')
  assert.equal(useStore.getState().playing, true)
  assert.equal(useStore.getState().loading, false)
  assert.equal(useStore.getState().error, null)
})

test('pause also invalidates a play promise already waiting on the audio device', async () => {
  const pending = deferred<void>()
  audio.nextPlay = pending.promise
  const playing = useStore.getState().play(song('pending'))
  await settle()
  useStore.getState().pause()
  pending.resolve()
  await playing
  assert.equal(audio.paused, true)
  assert.equal(useStore.getState().playing, false)
})

test('stale media events during a slow new resolution neither advance nor start recovery', async () => {
  await useStore.getState().play(song('old'))
  const pending = deferred<Awaited<ReturnType<GlassApi['resolve']>>>()
  let resolutions = 0
  api.resolve = () => { resolutions++; return pending.promise }
  const latest = useStore.getState().play(song('latest'), [song('latest'), song('next')])
  mock.timers.tick(5000)
  audio.dispatchEvent(new Event('play'))
  audio.dispatchEvent(new Event('error'))
  audio.dispatchEvent(new Event('ended'))
  assert.equal(resolutions, 1)
  assert.equal(useStore.getState().current?.key, 'latest')
  assert.equal(useStore.getState().playing, false)
  pending.resolve(stream('latest'))
  await latest
})

test('local tracks use local URLs on cold resume and at the end of the queue', async () => {
  let localCalls = 0
  let onlineCalls = 0
  api.localStreamUrl = async path => { localCalls++; return 'local:' + path }
  api.resolve = async item => { onlineCalls++; return stream(item.key) }
  const local: Song = { key: 'local:D:/music/local.mp3', name: 'local', artist: 'artist', origins: [] }
  useStore.setState({ current: local, queue: [local], queueIdx: 0 })
  await useStore.getState().togglePlay()
  assert.equal(localCalls, 1)
  audio.dispatchEvent(new Event('ended'))
  await settle()
  assert.equal(localCalls, 2)
  assert.equal(onlineCalls, 0)
  assert.equal(useStore.getState().playing, true)
})

test('quality changes retain the playlist even when search results have changed', async () => {
  const queue = [song('one'), song('two'), song('three')]
  const qualities: string[] = []
  api.resolve = async (item, quality) => { qualities.push(quality); return stream(item.key) }
  await useStore.getState().play(queue[1], queue)
  useStore.setState({ results: [song('unrelated')] })
  useStore.getState().setQuality('flac')
  await settle()
  assert.equal(useStore.getState().queue, queue)
  assert.equal(useStore.getState().queueIdx, 1)
  assert.deepEqual(qualities, ['320k', 'flac'])
})

test('resuming after a long pause resets the watchdog instead of reparsing the stream', async () => {
  let resolutions = 0
  api.resolve = async item => { resolutions++; return stream(item.key) }
  await useStore.getState().play(song('first'))
  audio.currentTime = 30
  audio.dispatchEvent(new Event('timeupdate'))
  useStore.getState().pause()
  mock.timers.tick(60000)
  await useStore.getState().togglePlay()
  mock.timers.tick(4000)
  await settle()
  assert.equal(resolutions, 1)
  assert.equal(useStore.getState().playing, true)
})

test('pausing during automatic recovery prevents its late result from resuming', async () => {
  await useStore.getState().play(song('first'))
  audio.currentTime = 40
  audio.dispatchEvent(new Event('timeupdate'))
  mock.timers.tick(1000)
  const recovery = deferred<Awaited<ReturnType<GlassApi['resolve']>>>()
  api.resolve = () => recovery.promise
  audio.error = { code: 2, message: 'test disconnect' }
  audio.dispatchEvent(new Event('error'))
  assert.equal(useStore.getState().loading, true)
  useStore.getState().pause()
  recovery.resolve(stream('recovered'))
  await settle()
  assert.equal(audio.playCalls, 1)
  assert.equal(audio.src, 'stream:first')
  assert.equal(useStore.getState().playing, false)
})

test('a genuine error in the first four seconds recovers instead of leaving paused audio stuck', async () => {
  await useStore.getState().play(song('early-error'))
  let resolutions = 0
  api.resolve = async () => { resolutions++; return stream('recovered-early') }
  mock.timers.tick(1000)
  audio.paused = true
  audio.error = { code: 2, message: 'early disconnect' }
  audio.dispatchEvent(new Event('error'))
  await settle()
  assert.equal(resolutions, 1)
  assert.equal(audio.src, 'stream:recovered-early')
  assert.equal(useStore.getState().playing, true)
  assert.equal(useStore.getState().loading, false)
})

test('a queued old error without a current media error cannot restart a successfully switched track', async () => {
  await useStore.getState().play(song('old-error'))
  await useStore.getState().play(song('new-error'))
  let resolutions = 0
  api.resolve = async () => { resolutions++; return stream('unwanted-recovery') }
  audio.dispatchEvent(new Event('error'))
  await settle()
  assert.equal(resolutions, 0)
  assert.equal(audio.src, 'stream:new-error')
  assert.equal(useStore.getState().playing, true)
})

test('switching tracks cancels a recovery waiting for metadata', async () => {
  await useStore.getState().play(song('first'))
  audio.currentTime = 40
  audio.dispatchEvent(new Event('timeupdate'))
  mock.timers.tick(4100)
  api.resolve = async item => stream(item.key === 'first' ? 'recovery' : item.key)
  audio.error = { code: 2, message: 'test disconnect' }
  audio.dispatchEvent(new Event('error'))
  await settle()
  assert.equal(audio.src, 'stream:recovery')
  assert.equal(audio.listeners.get('loadedmetadata')?.size, 1)
  await useStore.getState().play(song('latest'))
  audio.dispatchEvent(new Event('loadedmetadata'))
  await settle()
  assert.equal(audio.listeners.get('loadedmetadata')?.size, 0)
  assert.equal(audio.src, 'stream:latest')
  assert.equal(audio.playCalls, 2)
  assert.equal(useStore.getState().current?.key, 'latest')
})

test('a paused recovery releases metadata listeners without playing after their timeout', async () => {
  await useStore.getState().play(song('first'))
  audio.currentTime = 40
  audio.dispatchEvent(new Event('timeupdate'))
  mock.timers.tick(4100)
  audio.error = { code: 2, message: 'test disconnect' }
  audio.dispatchEvent(new Event('error'))
  await settle()
  assert.equal(audio.listeners.get('loadedmetadata')?.size, 1)
  useStore.getState().pause()
  mock.timers.tick(4100)
  await settle()
  assert.equal(audio.listeners.get('loadedmetadata')?.size, 0)
  assert.equal(audio.playCalls, 1)
  assert.equal(useStore.getState().playing, false)
})

test('a new track cancels delayed recovery retries for the old track', async () => {
  await useStore.getState().play(song('first'))
  mock.timers.tick(4100)
  let oldCalls = 0
  api.resolve = async item => {
    if (item.key === 'first') { oldCalls++; throw new Error('offline') }
    return stream(item.key)
  }
  audio.error = { code: 2, message: 'test disconnect' }
  audio.dispatchEvent(new Event('error'))
  await settle()
  await useStore.getState().play(song('latest'))
  mock.timers.tick(2500)
  await settle()
  assert.equal(oldCalls, 1)
  assert.equal(audio.src, 'stream:latest')
  assert.equal(useStore.getState().loading, false)
})

test('cover loading is bounded and publishes one batch without rewriting playback storage', async () => {
  const songs = Array.from({ length: 6 }, (_, index) => ({ ...song('pic-' + index), picUrl: undefined }))
  const requests: ReturnType<typeof deferred<string>>[] = []
  api.pic = () => {
    const request = deferred<string>()
    requests.push(request)
    return request.promise
  }
  useStore.setState({ results: songs, queue: songs, current: songs[0], queueIdx: 0 })
  storageWrites = 0
  let updates = 0
  const off = useStore.subscribe(() => { updates++ })
  useStore.getState().ensurePics(songs)
  assert.equal(requests.length, 4)
  requests.slice().forEach((request, index) => request.resolve('cover:' + index))
  await settle()
  assert.equal(requests.length, 6)
  requests.slice(4).forEach((request, index) => request.resolve('cover:' + (index + 4)))
  await settle()
  assert.equal(updates, 0)
  mock.timers.tick(50)
  assert.equal(updates, 1)
  assert.equal(useStore.getState().results.every(item => !!item.picUrl), true)
  assert.equal(storageWrites, 0)
  off()
})

test('an obsolete cover response does not create an irrelevant state update', async () => {
  const request = deferred<string>()
  api.pic = () => request.promise
  const old = { ...song('old-cover'), picUrl: undefined }
  useStore.setState({ results: [old] })
  useStore.getState().ensurePics([old])
  const latest = [song('latest')]
  useStore.setState({ results: latest })
  let updates = 0
  const off = useStore.subscribe(() => { updates++ })
  request.resolve('obsolete-cover')
  await settle()
  mock.timers.tick(50)
  assert.equal(updates, 0)
  assert.equal(useStore.getState().results, latest)
  off()
})
