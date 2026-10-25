import assert from 'node:assert/strict'
import { after, before, mock, test } from 'node:test'
import { SourceRegistry } from '../electron/main/sources/registry'
import { RequestCache } from '../electron/main/sources/requestCache'
import type { Song, SourceProvider } from '../electron/main/sources/spi'
import { currentIndex, lyricHasTimeline, parseLrc } from '../shared/lrc'

// These regressions use local fake providers only. Fail closed if a real API slips in.
before(() => { mock.method(globalThis, 'fetch', () => { throw new Error('Network disabled in registry tests') }) })
after(() => { mock.restoreAll() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function song(name = '晴天', providerId = 'first', songId = '1'): Song {
  return { key: `${name}|周杰伦`, name, artist: '周杰伦', origins: [{ providerId, platform: 'kw', songId }] }
}

function provider(id: string, overrides: Partial<SourceProvider> = {}): SourceProvider {
  return {
    id, name: id, kind: 'custom',
    caps: { platforms: ['kw'], qualities: ['128k'], supportsSearch: true },
    health: { status: 'ok', okCount: 0, failCount: 0 },
    resolveUrl: async () => { throw new Error('URL resolution is outside these tests') },
    ...overrides
  }
}

function registry(...providers: SourceProvider[]): SourceRegistry {
  const result = new SourceRegistry({ entries: [], resolveOrder: [] } as any)
  result.providers = providers
  return result
}

test('concurrent keywords and pages keep their own results despite reverse completion', async () => {
  const gates = new Map<string, ReturnType<typeof deferred<Song[]>>>()
  const source = provider('first', { search: (keyword, page) => {
    const gate = deferred<Song[]>()
    gates.set(`${keyword}:${page}`, gate)
    return gate.promise
  } })
  const sources = registry(source)
  const first = sources.search('A', 1)
  const recommended = sources.search('B', 1)
  const next = sources.search('A', 2)
  gates.get('A:2')!.resolve([song('A2')])
  gates.get('B:1')!.resolve([song('B1')])
  gates.get('A:1')!.resolve([song('A1')])
  const pages = await Promise.all([first, recommended, next])
  assert.deepEqual(pages.map(p => p.songs.map(s => s.name)), [['A1'], ['B1'], ['A2']])
  assert.deepEqual(pages.map(p => p.page), [1, 1, 2])
})

test('search normalizes real provider songs without changing the provider objects', async () => {
  const original = song('Ｈｅｌｌｏ－世界')
  original.artist = 'Artist feat. Guest'
  const duplicate = song(' hello 世界 ', 'second', '2')
  duplicate.artist = 'artist/Guest'
  duplicate.album = 'album'
  const result = await registry(
    provider('first', { search: async () => [original] }),
    provider('second', { search: async () => [duplicate] })
  ).search('hello')
  assert.equal(result.songs.length, 1)
  assert.equal(result.songs[0].key, 'hello世界|artist')
  assert.equal(result.songs[0].origins.length, 2)
  assert.equal(result.songs[0].album, 'album')
  assert.equal(original.origins.length, 1)
  assert.equal(original.album, undefined)
})

test('simultaneous cover consumers share one request and retain the successful result', async () => {
  const gate = deferred<string>()
  const entered = deferred<void>()
  let calls = 0
  const sources = registry(provider('first', { getPic: async () => {
    calls++
    entered.resolve()
    return gate.promise
  } }))
  const track = song()
  const first = sources.getPic(track)
  const second = sources.getPic({ ...track })
  await entered.promise
  assert.equal(calls, 1)
  gate.resolve('https://example.invalid/cover.jpg')
  assert.deepEqual(await Promise.all([first, second]), ['https://example.invalid/cover.jpg', 'https://example.invalid/cover.jpg'])
  assert.equal(await sources.getPic(track), 'https://example.invalid/cover.jpg')
  assert.equal(calls, 1)
})

test('simultaneous lyric consumers share one request and accept minute-zero timestamps', async () => {
  const gate = deferred<string>()
  const entered = deferred<void>()
  let calls = 0
  const sources = registry(provider('first', { getLyric: async () => {
    calls++
    entered.resolve()
    return gate.promise
  } }))
  const first = sources.getLyric(song())
  const second = sources.getLyric(song())
  await entered.promise
  assert.equal(calls, 1)
  const lyrics = '[00:01.20]第一行\n[00:05.30]第二行'
  gate.resolve(lyrics)
  assert.deepEqual(await Promise.all([first, second]), [lyrics, lyrics])
  assert.equal(await sources.getLyric(song()), lyrics)
  assert.equal(calls, 1)
})

test('cover and lyric lookup continue to the second compatible source on the same platform', async () => {
  const calls: string[] = []
  const lyrics = '[1.20]第一行\n[5.30]第二行'
  const sources = registry(
    provider('first', {
      getPic: async () => { calls.push('first:pic'); return undefined },
      getLyric: async () => { calls.push('first:lyric'); return '[00:00]暂无歌词' }
    }),
    provider('second', {
      getPic: async () => { calls.push('second:pic'); return 'https://example.invalid/cover' },
      getLyric: async () => { calls.push('second:lyric'); return lyrics }
    })
  )
  assert.equal(await sources.getPic(song()), 'https://example.invalid/cover')
  assert.equal(await sources.getLyric(song()), lyrics)
  assert.deepEqual(calls, ['first:pic', 'second:pic', 'first:lyric', 'second:lyric'])
})

test('parser handles seconds, standard minutes, multiple stamps, sorting and metadata', () => {
  assert.deepEqual(parseLrc('[ti:ignored]\n[01:23.45]标准\n[10.52]秒制\n[00:02.5][00:04.005]重复'), [
    { timeMs: 2500, text: '重复' }, { timeMs: 4005, text: '重复' },
    { timeMs: 10520, text: '秒制' }, { timeMs: 83450, text: '标准' }
  ])
  assert.equal(lyricHasTimeline('[00:01]一\n[00:02]二'), true)
  assert.equal(lyricHasTimeline('[1.2]一\n[5.3]二'), true)
  assert.equal(lyricHasTimeline('[ti:metadata]\n[00:00]暂无歌词'), false)
})

test('binary lyric lookup preserves the 300ms lead and selects the last equal timestamp', () => {
  const lines = [
    { timeMs: 1000, text: 'first' }, { timeMs: 2000, text: 'second' },
    { timeMs: 2000, text: 'translation' }, { timeMs: 3000, text: 'last' }
  ]
  assert.equal(currentIndex([], 10), -1)
  assert.equal(currentIndex(lines, 0.699), -1)
  assert.equal(currentIndex(lines, 0.7), 0)
  assert.equal(currentIndex(lines, 1.699), 0)
  assert.equal(currentIndex(lines, 1.7), 2)
  assert.equal(currentIndex(lines, 1000), 3)
})

test('request cache deduplicates pending work and expires positive values using its clock', async () => {
  let now = 0
  let calls = 0
  const cache = new RequestCache<string>(100, 30, 4, () => now)
  const gate = deferred<string>()
  const load = () => { calls++; return gate.promise }
  const first = cache.get('song', load)
  const second = cache.get('song', load)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  gate.resolve('cover')
  assert.equal(await first, 'cover')
  now = 99
  assert.equal(await cache.get('song', async () => 'unexpected'), 'cover')
  now = 100
  assert.equal(await cache.get('song', async () => 'updated'), 'updated')
})

test('request cache retries empty metadata after the shorter TTL', async () => {
  let now = 0
  let calls = 0
  const cache = new RequestCache<string | undefined>(100, 30, 4, () => now)
  const load = async () => { calls++; return calls === 1 ? undefined : 'available' }
  assert.equal(await cache.get('song', load), undefined)
  now = 29
  assert.equal(await cache.get('song', load), undefined)
  assert.equal(calls, 1)
  now = 30
  assert.equal(await cache.get('song', load), 'available')
  assert.equal(calls, 2)
})

test('request cache does not cache thrown errors or synchronously thrown loader errors', async () => {
  const cache = new RequestCache<string>()
  let calls = 0
  await assert.rejects(cache.get('song', async () => { calls++; throw new Error('temporary') }), /temporary/)
  await assert.rejects(cache.get('song', () => { calls++; throw new Error('sync') }), /sync/)
  assert.equal(await cache.get('song', async () => { calls++; return 'success' }), 'success')
  assert.equal(calls, 3)
})

test('clear prevents an old completion from repopulating values or deleting a newer pending request', async () => {
  const cache = new RequestCache<string>()
  const oldGate = deferred<string>()
  const newGate = deferred<string>()
  const oldRequest = cache.get('song', () => oldGate.promise)
  await Promise.resolve()
  cache.clear()
  const newRequest = cache.get('song', () => newGate.promise)
  oldGate.resolve('stale')
  assert.equal(await oldRequest, 'stale')
  const sharedNew = cache.get('song', async () => { throw new Error('new request was lost') })
  assert.equal(sharedNew, newRequest)
  newGate.resolve('fresh')
  assert.equal(await newRequest, 'fresh')
  assert.equal(await cache.get('song', async () => 'unexpected'), 'fresh')
})

test('request cache evicts the oldest stored result when the configured bound is exceeded', async () => {
  const cache = new RequestCache<string>(100, 30, 2, () => 0)
  await cache.get('A', async () => 'A1')
  await cache.get('B', async () => 'B1')
  await cache.get('C', async () => 'C1')
  assert.equal(await cache.get('B', async () => 'unexpected'), 'B1')
  assert.equal(await cache.get('A', async () => 'A2'), 'A2')
  assert.equal(await cache.get('C', async () => 'unexpected'), 'C1')
})
