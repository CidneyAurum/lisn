import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MediaServer, type MediaServerOptions } from '../electron/main/mediaServer'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(ok => { resolve = ok })
  return { promise, resolve }
}

function deadline<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test deadline exceeded')), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

async function fixture(t: TestContext, handler: http.RequestListener, options: MediaServerOptions = {}) {
  const upstream = http.createServer(handler)
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const port = (upstream.address() as { port: number }).port
  const proxy = new MediaServer({ headerTimeoutMs: 500, stallTimeoutMs: 500, retryDelayMs: 1, ...options })
  await proxy.start()
  t.after(async () => {
    proxy.stop()
    upstream.closeAllConnections()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })
  const target = (route = '/') => 'http://127.0.0.1:' + port + route
  return { proxy, target, url: (route = '/') => proxy.streamUrlFor(target(route)) }
}

function get(url: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return deadline(new Promise((resolve, reject) => {
    const request = http.request(url, { headers, method, agent: false }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    request.on('error', reject)
    request.end()
  }))
}

const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))

test('a continuously streaming body outlives the response-header deadline without reconnecting', async t => {
  let requests = 0
  const { url } = await fixture(t, (_request, response) => {
    requests++
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '6' })
    response.flushHeaders()
    let sent = 0
    response.write(String(sent++))
    const timer = setInterval(() => {
      response.write(String(sent++))
      if (sent === 6) { clearInterval(timer); response.end() }
    }, 55)
    response.once('close', () => clearInterval(timer))
  }, { headerTimeoutMs: 80, stallTimeoutMs: 300 })
  const result = await get(url())
  assert.equal(result.status, 200)
  assert.equal(result.body.toString(), '012345')
  assert.equal(requests, 1)
})

test('a header timeout cancels that attempt and preserves range headers on the first successful response', async t => {
  const ranges: (string | undefined)[] = []
  const closed = deferred<void>()
  const { url } = await fixture(t, (request, response) => {
    ranges.push(request.headers.range)
    if (ranges.length === 1) { response.once('close', () => closed.resolve()); return }
    response.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 100-109/256', 'Content-Length': '10' })
    response.end(bytes.subarray(100, 110))
  }, { headerTimeoutMs: 60 })
  const result = await get(url(), { Range: 'bytes=100-109' })
  await deadline(closed.promise)
  assert.equal(result.status, 206)
  assert.equal(result.headers['content-range'], 'bytes 100-109/256')
  assert.deepEqual(result.body, bytes.subarray(100, 110))
  assert.deepEqual(ranges, ['bytes=100-109', 'bytes=100-109'])
})

test('a stalled read reconnects from the absolute offset of a nonzero client range', async t => {
  const ranges: (string | undefined)[] = []
  const { url } = await fixture(t, (request, response) => {
    ranges.push(request.headers.range)
    if (ranges.length === 1) {
      response.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 100-149/256', 'Content-Length': '50' })
      response.write(bytes.subarray(100, 110))
      return
    }
    response.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 110-149/256', 'Content-Length': '40' })
    response.end(bytes.subarray(110, 150))
  }, { stallTimeoutMs: 40 })
  const result = await get(url(), { Range: 'bytes=100-149' })
  assert.deepEqual(ranges, ['bytes=100-149', 'bytes=110-149'])
  assert.equal(result.headers['content-length'], '50')
  assert.equal(result.headers['content-range'], 'bytes 100-149/256')
  assert.deepEqual(result.body, bytes.subarray(100, 150))
})

test('a retry that ignores Range skips the absolute offset and stops at the original end', async t => {
  const ranges: (string | undefined)[] = []
  const { url } = await fixture(t, (request, response) => {
    ranges.push(request.headers.range)
    if (ranges.length === 1) {
      response.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 100-149/256', 'Content-Length': '50' })
      response.write(bytes.subarray(100, 110))
      const timer = setTimeout(() => response.destroy(), 20)
      response.once('close', () => clearTimeout(timer))
      return
    }
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length) })
    response.end(bytes)
  })
  const result = await get(url(), { Range: 'bytes=100-149' })
  assert.deepEqual(ranges, ['bytes=100-149', 'bytes=110-149'])
  assert.deepEqual(result.body, bytes.subarray(100, 150))
})

test('an initial upstream 200 that ignored Range is retried as a full-file response', async t => {
  const ranges: (string | undefined)[] = []
  const { url } = await fixture(t, (request, response) => {
    ranges.push(request.headers.range)
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length) })
    if (ranges.length === 1) {
      response.write(bytes.subarray(0, 10))
      const timer = setTimeout(() => response.destroy(), 20)
      response.once('close', () => clearTimeout(timer))
    } else response.end(bytes)
  })
  const result = await get(url(), { Range: 'bytes=100-149' })
  assert.equal(result.status, 200)
  assert.deepEqual(ranges, ['bytes=100-149', 'bytes=10-255'])
  assert.deepEqual(result.body, bytes)
})

test('suffix-range reconnection derives its absolute start from Content-Range', async t => {
  const ranges: (string | undefined)[] = []
  const { url } = await fixture(t, (request, response) => {
    ranges.push(request.headers.range)
    const start = ranges.length === 1 ? 236 : 241
    response.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${start}-255/256`, 'Content-Length': String(256 - start) })
    if (ranges.length === 1) {
      response.write(bytes.subarray(236, 241))
      const timer = setTimeout(() => response.destroy(), 20)
      response.once('close', () => clearTimeout(timer))
    } else response.end(bytes.subarray(241))
  })
  const result = await get(url(), { Range: 'bytes=-20' })
  assert.deepEqual(ranges, ['bytes=-20', 'bytes=241-255'])
  assert.deepEqual(result.body, bytes.subarray(236))
})

test('a fresh parser URL ends a partial response instead of mixing bytes from different files', async t => {
  let originalRequests = 0
  let replacementRequests = 0
  let freshCalls = 0
  const { proxy, target } = await fixture(t, (request, response) => {
    if (request.url === '/replacement') {
      replacementRequests++
      // Same size and a plausible range are insufficient to establish file identity.
      response.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 3-5/6', 'Content-Length': '3' })
      response.end('XYZ')
      return
    }
    originalRequests++
    if (originalRequests === 1) {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '6' })
      response.write('abc')
      const timer = setTimeout(() => response.destroy(), 20)
      response.once('close', () => clearTimeout(timer))
    } else { response.writeHead(503); response.end() }
  })
  proxy.freshUrlProvider = async () => { freshCalls++; return target('/replacement') }
  const result = await deadline(new Promise<{ body: Buffer; complete: boolean }>((resolve, reject) => {
    const request = http.get(proxy.streamUrlFor(target('/original'), { songJson: '{"key":"song"}' }), { agent: false }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ body: Buffer.concat(chunks), complete: true }))
      response.on('aborted', () => resolve({ body: Buffer.concat(chunks), complete: false }))
      response.on('error', () => {})
    })
    request.on('error', reject)
  }))
  assert.equal(originalRequests, 2)
  assert.equal(freshCalls, 1)
  assert.equal(replacementRequests, 0)
  assert.equal(result.complete, false)
  assert.equal(result.body.toString(), 'abc')
})

test('disconnecting while waiting for response headers cancels the upstream without retries', async t => {
  const seen = deferred<void>()
  const closed = deferred<void>()
  let requests = 0
  const { url } = await fixture(t, (_request, response) => {
    requests++
    response.once('close', () => closed.resolve())
    seen.resolve()
  })
  const request = http.get(url(), { agent: false })
  request.on('error', () => {})
  await deadline(seen.promise)
  request.destroy()
  await deadline(closed.promise)
  assert.equal(requests, 1)
})

test('disconnecting during a pending body read cancels the upstream immediately', async t => {
  const closed = deferred<void>()
  let requests = 0
  const { url } = await fixture(t, (_request, response) => {
    requests++
    response.once('close', () => closed.resolve())
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '100' })
    response.write('a')
  }, { stallTimeoutMs: 5000 })
  await deadline(new Promise<void>(resolve => {
    const request = http.get(url(), { agent: false }, response => {
      response.once('data', () => { request.destroy(); response.destroy(); resolve() })
      response.on('error', () => {})
    })
    request.on('error', () => {})
  }))
  await deadline(closed.promise)
  assert.equal(requests, 1)
})

test('disconnecting a backpressured client releases the upstream instead of waiting forever for drain', async t => {
  const closed = deferred<void>()
  const piece = Buffer.alloc(64 * 1024)
  let emitted = 0
  const total = 100 * 1024 * 1024
  const { url } = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(total) })
    response.once('close', () => closed.resolve())
    const pump = () => {
      while (!response.destroyed && emitted < total) {
        emitted += piece.length
        if (!response.write(piece)) { response.once('drain', pump); return }
      }
      if (!response.destroyed) response.end()
    }
    pump()
  }, { stallTimeoutMs: 5000 })
  await deadline(new Promise<void>(resolve => {
    const request = http.get(url(), { agent: false }, response => {
      response.pause()
      const timer = setTimeout(() => { request.destroy(); response.destroy(); resolve() }, 50)
      response.once('close', () => clearTimeout(timer))
      response.on('error', () => {})
    })
    request.on('error', () => {})
  }))
  await deadline(closed.promise)
  assert.ok(emitted < total, 'the upstream must stop before the unread large body is transferred')
})

test('exhausting a header deadline returns 502 and closes the unfinished upstream', async t => {
  const closed = deferred<void>()
  const { url } = await fixture(t, (_request, response) => { response.once('close', () => closed.resolve()) }, { headerTimeoutMs: 40, maxAttempts: 1 })
  const result = await get(url())
  assert.equal(result.status, 502)
  await deadline(closed.promise)
})

test('local files containing percent signs are decoded once, with valid range and suffix support', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lisn-media-test-'))
  t.after(() => {
    const resolved = path.resolve(directory)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('lisn-media-test-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  const file = path.join(directory, 'artist - 100% + %20 文件.FLAC')
  fs.writeFileSync(file, bytes)
  const { proxy } = await fixture(t, (_request, response) => { response.writeHead(500); response.end() })
  const url = proxy.localUrlFor(file)
  const full = await get(url)
  assert.equal(full.status, 200)
  assert.equal(full.headers['content-type'], 'audio/flac')
  assert.deepEqual(full.body, bytes)
  const partial = await get(url, { Range: 'bytes=5-9' })
  assert.equal(partial.status, 206)
  assert.equal(partial.headers['content-range'], 'bytes 5-9/256')
  assert.deepEqual(partial.body, bytes.subarray(5, 10))
  const suffix = await get(url, { Range: 'bytes=-5' })
  assert.equal(suffix.headers['content-range'], 'bytes 251-255/256')
  assert.deepEqual(suffix.body, bytes.subarray(251))
  for (const range of ['bytes=256-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,3-4']) {
    const invalid = await get(url, { Range: range })
    assert.equal(invalid.status, 416, range)
    assert.equal(invalid.headers['content-range'], 'bytes */256')
  }
  const head = await get(url, { Range: 'bytes=5-9' }, 'HEAD')
  assert.equal(head.status, 206)
  assert.equal(head.headers['content-length'], '5')
  assert.equal(head.body.length, 0)
})
