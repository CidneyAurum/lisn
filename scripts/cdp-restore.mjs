const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'err'); return r.result?.value }
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

console.log('[1] 搜索+播放(建立队列)…')
await evaluate(`__store.getState().doSearch('晴天')`)
await new Promise(r => setTimeout(r, 8000))
await evaluate(`__store.getState().play(__store.getState().results[0])`)
await new Promise(r => setTimeout(r, 12000))
const before = await evaluate(`(() => { const s = __store.getState(); return { queue: s.queue.length, idx: s.queueIdx, current: s.current?.name, playing: s.playing } })()`)
console.log('    播放态:', JSON.stringify(before))

console.log('[2] 重载渲染进程(模拟应用重启)…')
await send('Page.reload')
await new Promise(r => setTimeout(r, 6000))
const after = await evaluate(`(() => { const s = __store.getState(); return { queue: s.queue.length, idx: s.queueIdx, current: s.current?.name, streamUrl: !!s.streamUrl } })()`)
console.log('    重载后:', JSON.stringify(after))
if (!after.queue || !after.current) throw new Error('队列未恢复!')

console.log('[3] 点播放(应重新解析当前曲)…')
await evaluate(`__store.getState().play(__store.getState().current, __store.getState().queue)`)
await new Promise(r => setTimeout(r, 12000))
const resumed = await evaluate(`(() => { const s = __store.getState(); return { playing: s.playing, resolve: s.resolveInfo?.providerId + '/' + s.resolveInfo?.quality } })()`)
console.log('    恢复播放:', JSON.stringify(resumed))
if (!resumed.playing) throw new Error('重播失败')
console.log('\n=== QUEUE RESTORE E2E: ALL PASS ===')
process.exit(0)
