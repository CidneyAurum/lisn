// Offline integration checks against the built production renderer.
// Requires a local Chrome and Node with native fetch/WebSocket; never uses a user profile.
// Run: node scripts/ui-regression.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = join(root, 'out', 'renderer')
const chromePath = process.env.LISN_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = ms => new Promise(done => setTimeout(done, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
        else pending.resolve(message.result)
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params, message.sessionId)
      }
    })
    ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('CDP connection closed'))
      }
      this.pending.clear()
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((done, fail) => {
      ws.addEventListener('open', done, { once: true })
      ws.addEventListener('error', fail, { once: true })
    })
    return new Cdp(ws)
  }
  on(method, listener) {
    const list = this.listeners.get(method) || []
    list.push(listener)
    this.listeners.set(method, list)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 10_000)
      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
}

function installFixtures() {
  const makeSong = (key, platform = 'kw') => ({
    key, name: `离线歌曲 ${key}`, artist: '离线歌手', origins: [{ providerId: 'offline', platform, songId: key }]
  })
  const search = [makeSong('search-a'), makeSong('search-b', 'wy'), makeSong('search-c')]
  const daily = [makeSong('daily-a'), makeSong('daily-b')]
  const custom = { id: 'custom-one', name: '离线自建歌单', createdAt: 1, songs: [makeSong('custom-a')] }
  const settings = { quality: '320k', playMode: 'loop', mode: 'auto', intervalMs: 2500, autoCheckUpdates: false, downloadDir: 'offline' }
  const sources = { providers: [], mode: 'auto', lxEntries: [], mfEntries: [], templates: [], resolveOrder: [] }
  const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#39c5bb"/></svg>')
  const mock = window.__mock = {
    makeSong, search, daily, custom, calls: [], unhandled: [], holdLyrics: new Set(), holdResolve: new Set(),
    pendingLyrics: new Map(), pendingResolve: new Map(), playCount: 0,
    releaseLyrics(key, raw) {
      for (const done of this.pendingLyrics.get(key) || []) done(raw)
      this.pendingLyrics.delete(key)
      this.holdLyrics.delete(key)
    },
    releaseResolve(key) {
      for (const done of this.pendingResolve.get(key) || []) done(stream(key))
      this.pendingResolve.delete(key)
      this.holdResolve.delete(key)
    }
  }
  const stream = key => ({ url: `${location.origin}/offline-audio/${key}`, streamUrl: `${location.origin}/offline-audio/${key}`, providerId: 'offline', platform: 'kw', quality: '320k' })
  const hold = (map, key) => new Promise(done => map.set(key, [...(map.get(key) || []), done]))
  const noOpSubscription = () => () => {}
  const api = {
    getSettings: async () => ({ ...settings }),
    patchSettings: async patch => Object.assign(settings, patch),
    sources: async () => sources,
    queue: async () => [],
    plList: async () => [custom],
    pic: async () => cover,
    search: async (keyword, page = 1) => {
      mock.calls.push({ method: 'search', keyword, page })
      return { songs: keyword === '离线搜索' ? search : daily, page, hasMore: false }
    },
    resolve: async song => {
      mock.calls.push({ method: 'resolve', key: song.key })
      return mock.holdResolve.has(song.key) ? hold(mock.pendingResolve, song.key) : stream(song.key)
    },
    lyric: async song => {
      mock.calls.push({ method: 'lyric', key: song.key })
      if (mock.holdLyrics.has(song.key)) return hold(mock.pendingLyrics, song.key)
      const text = song.key.startsWith('local:') ? 'LOCAL_LYRIC' : song.key === 'quick-new' ? 'NEW_LYRIC' : 'STEADY_LYRIC'
      return `[00:00]${text}\n[01:00]SECOND_LYRIC`
    },
    localStreamUrl: async path => `${location.origin}/offline-local/${encodeURIComponent(path)}`,
    libraryScan: async () => ({ dir: 'offline', files: [{ filePath: 'offline-song.mp3', name: '离线本地歌', artist: '本地歌手', isFlac: false, size: 1000, mtime: 1 }] }),
    enqueue: async song => ({ id: song.key, status: 'waiting' }),
    limbusVisible: async () => false,
    limbusToggle: async () => false,
    overlayPushLyrics() {}, overlayPushPos() {}, overlaySetConfig() {}, diag() {},
    minimize() {}, maximize() {}, close() {},
    onQueue: noOpSubscription, onTrayControl: noOpSubscription, onSourcesChanged: noOpSubscription,
    onPlaylistsChanged: noOpSubscription, onLimbusState: noOpSubscription,
    onOverlayRepush: noOpSubscription, onLimbusConfig: noOpSubscription
  }
  window.glass = new Proxy(api, {
    get(target, key) {
      if (key in target) return target[key]
      return () => { mock.unhandled.push(String(key)); throw new Error(`Unmocked IPC: ${String(key)}`) }
    }
  })

  // Preserve real HTMLAudioElement/EventTarget behavior without decoding or requesting audio.
  const media = new WeakMap()
  const state = element => {
    if (!media.has(element)) media.set(element, { src: '', time: 0, paused: true })
    return media.get(element)
  }
  Object.defineProperties(HTMLMediaElement.prototype, {
    src: { configurable: true, get() { return state(this).src }, set(value) {
      const data = state(this)
      data.src = String(value); data.time = 0
      queueMicrotask(() => { this.dispatchEvent(new Event('loadedmetadata')); this.dispatchEvent(new Event('durationchange')) })
    } },
    currentSrc: { configurable: true, get() { return state(this).src } },
    currentTime: { configurable: true, get() { return state(this).time }, set(value) { state(this).time = Number(value) } },
    duration: { configurable: true, get() { return 180 } },
    paused: { configurable: true, get() { return state(this).paused } },
    readyState: { configurable: true, get() { return 4 } },
    buffered: { configurable: true, get() { return { length: 1, start: () => 0, end: () => 180 } } }
  })
  HTMLMediaElement.prototype.play = function () {
    state(this).paused = false
    mock.playCount++
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () {
    if (!state(this).paused) {
      state(this).paused = true
      this.dispatchEvent(new Event('pause'))
    }
  }
  HTMLMediaElement.prototype.load = function () {}

  // React's production DevTools hook reports commits. Count performed work only when the
  // current fiber changed; untouched subtrees can retain old flags and must not be counted.
  const previous = new Map()
  window.__renderCounts = {}
  window.__reactInjected = false
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject() { window.__reactInjected = true; return 1 },
    onCommitFiberRoot(_renderer, root) {
      const next = new Map()
      const visit = fiber => {
        if (!fiber) return
        const type = fiber.type
        const name = type?.name || type?.displayName || type?.type?.name
        if (['FullPlayer', 'AddToPlaylistDialog', 'LyricLines', 'PlaybackProgress'].includes(name)) {
          next.set(name, fiber)
          if (previous.has(name) && previous.get(name) !== fiber && (fiber.flags & 1)) {
            window.__renderCounts[name] = (window.__renderCounts[name] || 0) + 1
          }
        }
        visit(fiber.child)
        visit(fiber.sibling)
      }
      visit(root.current)
      previous.clear()
      for (const [key, fiber] of next) previous.set(key, fiber)
    },
    onCommitFiberUnmount() {}
  }
}

await access(chromePath)
await access(join(renderer, 'index.html'))
const tempBase = await mkdtemp(join(tmpdir(), 'lisn-ui-regression-'))
const profile = join(tempBase, 'profile')
const results = []
const runtimeErrors = []
const blockedRequests = []
let chrome, cdp, sessionId
let chromeExited = false
let chromeLog = ''
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const path = resolve(renderer, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(renderer + sep)) { response.writeHead(403).end(); return }
    const content = await readFile(path)
    response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] || 'application/octet-stream' })
    response.end(content)
  } catch { response.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

try {
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--metrics-recording-only', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1440,1000',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  chrome.once('exit', () => { chromeExited = true })
  chrome.stderr.on('data', data => { chromeLog = (chromeLog + String(data)).slice(-5000) })
  let endpoint
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chromeExited) throw new Error(`Chrome exited before CDP started: ${chromeLog}`)
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
      endpoint = `ws://127.0.0.1:${port}${path}`
      break
    } catch { await sleep(100) }
  }
  if (!endpoint) throw new Error(`Chrome CDP startup timed out: ${chromeLog}`)
  cdp = await Cdp.connect(endpoint)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }))
  cdp.on('Runtime.exceptionThrown', event => runtimeErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
  cdp.on('Runtime.consoleAPICalled', event => {
    if (event.type === 'error') runtimeErrors.push(event.args.map(arg => arg.value || arg.description || '').join(' '))
  })
  cdp.on('Fetch.requestPaused', (event, session) => {
    const url = event.request.url
    const local = url.startsWith(origin + '/') || /^(data:|blob:|about:)/.test(url)
    if (!local) blockedRequests.push(url)
    void cdp.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
      requestId: event.requestId, ...(!local ? { errorReason: 'BlockedByClient' } : {})
    }, session).catch(() => {})
  })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId)
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})()` }, sessionId)
  await cdp.send('Page.navigate', { url: origin + '/' }, sessionId)

  const evaluate = async (fn, ...args) => {
    const response = await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true
    }, sessionId)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result.value
  }
  const waitFor = async (fn, description) => {
    // DOM nodes carry React references; return only a boolean across the CDP boundary.
    const predicate = new Function(`return Boolean((${fn.toString()})())`)
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(predicate)) return
      if (runtimeErrors.length) throw new Error(runtimeErrors.join('\n'))
      await sleep(30)
    }
    throw new Error(`UI condition timed out: ${description}`)
  }
  const click = selector => evaluate(selector => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing UI element: ${selector}`)
    element.click()
  }, selector)
  const check = async (name, action) => {
    const detail = await action()
    assert.deepEqual(runtimeErrors, [], 'No renderer exceptions')
    results.push({ name, status: 'PASS', ...(detail ? { detail } : {}) })
    console.log(`PASS ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`)
  }

  await waitFor(() => window.__store && document.querySelector('.hero-card.daily') && window.__store.getState().playlists.length === 1, 'production app mount')

  await check('filtered search row plays only the visible result queue', async () => {
    await evaluate(async () => {
      window.__store.getState().setView('search')
      await window.__store.getState().doSearch('离线搜索')
    })
    await waitFor(() => document.querySelectorAll('.song-row').length === 3, 'search rows')
    await evaluate(() => [...document.querySelectorAll('.chip')].find(button => button.textContent.trim() === '酷我').click())
    await waitFor(() => document.querySelectorAll('.song-row').length === 2, 'filtered search rows')
    await click('.song-row button[title="播放"]')
    await waitFor(() => window.__store.getState().playing, 'filtered song playback')
    assert.deepEqual(await evaluate(() => window.__store.getState().queue.map(song => song.key)), ['search-a', 'search-c'])
  })

  await check('daily playlist playback uses the daily queue without replacing search results', async () => {
    await evaluate(() => window.__store.getState().setView('discover'))
    await waitFor(() => document.querySelector('.hero-card.daily'), 'daily recommendation card')
    await click('.hero-card.daily')
    await waitFor(() => window.__store.getState().playlist?.kind === 'agg' && document.querySelectorAll('.song-row').length === 2, 'daily playlist rows')
    await click('.song-row button[title="播放"]')
    await waitFor(() => window.__store.getState().current?.key === 'daily-a' && window.__store.getState().playing, 'daily playback')
    assert.deepEqual(await evaluate(() => window.__store.getState().queue.map(song => song.key)), ['daily-a', 'daily-b'])
    assert.deepEqual(await evaluate(() => window.__store.getState().results.map(song => song.key)), ['search-a', 'search-b', 'search-c'])
    await evaluate(() => { window.__mock.savedDaily = window.__store.getState().playlist })
  })

  await check('custom and aggregate playlists switch in place without conditional-hook errors', async () => {
    await evaluate(() => { window.__mock.playlistRoot = document.querySelector('.view-enter') })
    for (let cycle = 0; cycle < 3; cycle++) {
      await evaluate(() => window.__store.setState({ playlist: { kind: 'custom', id: 'custom-one' } }))
      await waitFor(() => document.querySelector('.view-enter')?.textContent.includes('离线自建歌单'), 'custom playlist')
      await evaluate(() => window.__store.setState({ playlist: window.__mock.savedDaily }))
      await waitFor(() => document.querySelector('.view-enter')?.textContent.includes('每日推荐'), 'aggregate playlist')
    }
    assert.equal(await evaluate(() => document.querySelector('.view-enter') === window.__mock.playlistRoot), true)
  })

  await check('local tracks without online origins display their local lyrics', async () => {
    await evaluate(() => window.__store.getState().setView('library'))
    await waitFor(() => document.querySelector('.song-row .song-name')?.textContent === '离线本地歌', 'local library row')
    await evaluate(() => document.querySelector('.song-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await waitFor(() => window.__store.getState().current?.key === 'local:offline-song.mp3' && window.__store.getState().playing, 'local track playback')
    await click('.dock-track')
    await waitFor(() => document.querySelector('.fp-lyrics')?.textContent.includes('LOCAL_LYRIC'), 'local lyrics')
    assert.equal(await evaluate(() => window.__mock.calls.some(call => call.method === 'lyric' && call.key === 'local:offline-song.mp3')), true)
  })

  await check('slower lyrics from a previous track cannot overwrite the current lyrics', async () => {
    await evaluate(() => {
      window.__mock.holdLyrics.add('quick-old')
      void window.__store.getState().play(window.__mock.makeSong('quick-old'))
    })
    await waitFor(() => window.__mock.pendingLyrics.has('quick-old'), 'delayed old lyric request')
    await evaluate(() => { void window.__store.getState().play(window.__mock.makeSong('quick-new')) })
    await waitFor(() => document.querySelector('.fp-lyrics')?.textContent.includes('NEW_LYRIC'), 'new track lyrics')
    await evaluate(() => window.__mock.releaseLyrics('quick-old', '[00:00]STALE_LYRIC'))
    await sleep(120)
    assert.equal(await evaluate(() => document.querySelector('.fp-lyrics')?.textContent.includes('NEW_LYRIC') && !document.querySelector('.fp-lyrics')?.textContent.includes('STALE_LYRIC')), true)
  })

  for (const [name, key, selector] of [['fullscreen', 'pending-full', '.fp-play'], ['dock', 'pending-dock', '.play-btn']]) {
    await check(`${name} loading button pauses and a late resolve cannot resume playback`, async () => {
      if (name === 'dock') {
        await click('.fp-close')
        await waitFor(() => !document.querySelector('.full-player'), 'fullscreen close')
      }
      await evaluate(key => {
        window.__mock.holdResolve.add(key)
        void window.__store.getState().play(window.__mock.makeSong(key))
      }, key)
      await waitFor(() => window.__store.getState().loading, 'pending resolution')
      const before = await evaluate(() => window.__mock.playCount)
      await click(selector)
      await waitFor(() => !window.__store.getState().loading && !window.__store.getState().playing, 'pause during loading')
      await evaluate(key => window.__mock.releaseResolve(key), key)
      await sleep(120)
      assert.equal(await evaluate(() => window.__store.getState().playing), false)
      assert.equal(await evaluate(() => window.__mock.playCount), before)
    })
  }

  await check('timeupdate stays in progress components and preserves fullscreen dialog and lyric DOM', async () => {
    await evaluate(async () => { await window.__store.getState().play(window.__mock.makeSong('steady')) })
    await click('.dock-track')
    await waitFor(() => document.querySelector('.fp-lyrics')?.textContent.includes('STEADY_LYRIC'), 'steady lyrics')
    await evaluate(() => { window.__audio.currentTime = 10; window.__audio.dispatchEvent(new Event('timeupdate')) })
    await click('.fp-title button[title="加入歌单"]')
    await waitFor(() => document.querySelector('.dlg-input'), 'add-to-playlist dialog')
    await sleep(400)
    const observed = await evaluate(async () => {
      const full = document.querySelector('.full-player')
      const dialog = document.querySelector('.dlg')
      const input = document.querySelector('.dlg-input')
      const lyrics = document.querySelector('.fp-lyrics')
      const lines = [...lyrics.children]
      input.value = 'keep-draft'
      const changes = { added: 0, removed: 0 }
      const observer = new MutationObserver(records => {
        for (const record of records) { changes.added += record.addedNodes.length; changes.removed += record.removedNodes.length }
      })
      observer.observe(full, { childList: true, subtree: true })
      window.__renderCounts = {}
      for (let index = 1; index <= 30; index++) {
        window.__audio.currentTime = 10 + index / 100
        window.__audio.dispatchEvent(new Event('timeupdate'))
        await new Promise(done => setTimeout(done, 16))
      }
      await new Promise(done => setTimeout(done, 50))
      observer.disconnect()
      return {
        events: 30, changes, reactHook: window.__reactInjected, renders: window.__renderCounts,
        sameNodes: full === document.querySelector('.full-player') && dialog === document.querySelector('.dlg') && lyrics === document.querySelector('.fp-lyrics') && lines.every((line, index) => line === lyrics.children[index]),
        draft: input.value
      }
    })
    assert.equal(observed.reactHook, true, 'Production React commit instrumentation attached')
    assert.equal(observed.sameNodes, true)
    assert.equal(observed.draft, 'keep-draft')
    assert.deepEqual(observed.changes, { added: 0, removed: 0 })
    assert.equal(observed.renders.FullPlayer || 0, 0)
    assert.equal(observed.renders.AddToPlaylistDialog || 0, 0)
    assert.ok((observed.renders.LyricLines || 0) <= 1)
    assert.ok(observed.renders.PlaybackProgress > 0, 'Actual progress components rendered')
    return observed
  })

  assert.deepEqual(await evaluate(() => window.__mock.unhandled), [], 'All IPC stayed inside explicit offline fixtures')
  console.log(JSON.stringify({ passed: results.length, renderer: 'production out/renderer', realAudioDecoding: false, network: 'renderer requests intercepted; only local server allowed', blockedRequests, results }, null, 2))
} catch (error) {
  console.error(error.stack || error)
  if (runtimeErrors.length) console.error('Renderer errors:', runtimeErrors)
  process.exitCode = 1
} finally {
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {})
    cdp.ws.close()
  }
  if (chrome && !chromeExited) {
    for (let attempt = 0; attempt < 50 && !chromeExited; attempt++) await sleep(100)
    // Only the process spawned above is eligible for termination.
    if (!chromeExited) chrome.kill()
  }
  await new Promise(done => server.close(done))
  // Never recursively remove a computed path without confirming the task's exact temp root.
  assert.equal(dirname(tempBase), resolve(tmpdir()))
  assert.ok(basename(tempBase).startsWith('lisn-ui-regression-'))
  assert.equal(resolve(profile), resolve(tempBase, 'profile'))
  await rm(tempBase, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
