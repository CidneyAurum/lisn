/**
 * 音源层冒烟测试（纯 Node 运行，不需要 Electron）
 * 验证链路：GD 搜索 → lx 沙箱加载 Huibq 脚本 → VIP 曲解析 → 真实 MP3 字节
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { GdProvider } from '../electron/main/sources/gdapi'
import { LxSourceManager } from '../electron/main/sources/lx-runner/manager'

// lx 沙箱内脚本（如 ikun 的启动自检）可能产生与断言无关的网络 rejection，不作为失败判据
process.on('unhandledRejection', (reason) => {
  console.log('  (unhandledRejection 已拦截:', String(reason).slice(0, 90) + ')')
})

async function main(): Promise<void> {
  console.log('=== [1] GD 搜索 ===')
  const gd = new GdProvider()
  let songs = await gd.search('周杰伦 晴天')
  // GD 偶发限流导致单源空结果,重试一次再判定
  if (!songs.some(s2 => s2.origins.some(o => o.platform === 'kw'))) {
    console.log('  (kw 首搜为空 —— GD 偶发限流,3s 后重试)')
    await new Promise(r => setTimeout(r, 3000))
    songs = await gd.search('周杰伦 晴天')
  }
  console.log('GD 搜索返回:', songs.length, '条')
  const kwSong = songs.find(s => s.origins.some(o => o.platform === 'kw'))
  const wySong = songs.find(s => s.origins.some(o => o.platform === 'wy'))
  console.log('kw 命中:', kwSong?.name, '/', kwSong?.artist, '| wy 命中:', wySong?.name ?? '(无)')
  if (!kwSong) throw new Error('kw 搜索无结果')

  console.log('\n=== [2] lx 沙箱加载音源脚本 ===')
  const dir = path.join(os.tmpdir(), 'glass-smoke-' + Date.now())
  const lx = new LxSourceManager(dir)
  await lx.init()
  const loadResult = await lx.loadAll()
  console.log('加载成功:', loadResult.ok, '| 失败:', JSON.stringify(loadResult.failed))
  if (!loadResult.ok.length) throw new Error('所有 lx 脚本加载失败')

  console.log('\n=== [3] VIP 曲解析（kw 通道 320k）===')
  const kwOrigin = kwSong.origins.find(o => o.platform === 'kw')!
  const providers = lx.entries.filter(e => e.enabled).map(e => ({ entry: e, provider: lx.providerFor(e) }))
  let resolved: { url: string; by: string } | null = null
  const errors: string[] = []
  for (const { entry, provider } of providers) {
    if (!provider) continue
    try {
      const url = await provider.resolveUrl(kwOrigin, '320k')
      resolved = { url, by: provider.name + ' (' + entry.id + ')' }
      console.log('解析成功 via', resolved.by)
      console.log('URL:', resolved.url.slice(0, 90) + '…')
      break
    } catch (e) { errors.push(entry.id + ': ' + (e instanceof Error ? e.message : String(e))) }
  }
  if (!resolved) { console.log('解析失败明细:', errors); throw new Error('所有 lx 源解析失败') }

  console.log('\n=== [4] 验证真实 MP3 字节 ===')
  const res = await fetch(resolved.url, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-2047' } })
  const buf = new Uint8Array(await res.arrayBuffer())
  const head = Array.from(buf.slice(0, 3)).map(b => b.toString(16).padStart(2, '0')).join(' ')
  const total = res.headers.get('content-range') ?? ''
  console.log('HTTP', res.status, '| 头部字节:', head, '| 大小:', total)
  const isMp3 = head.startsWith('ff fb') || head.startsWith('49 44 33') || (res.headers.get('content-type') ?? '').includes('audio')
  console.log('真实音频:', isMp3 ? '✅ 是' : '❌ 否')

  console.log('\n=== [5] GD pic/lyric 端点 ===')
  const pic = await gd.getPic(kwOrigin).catch(() => undefined)
  const lyric = await gd.getLyric(kwOrigin).catch(() => undefined)
  console.log('封面:', pic ? pic.slice(0, 70) + '…' : '(无)', '| 歌词:', lyric ? (String(lyric).length + ' 字符') : '(无)')

  console.log('\n========== 冒烟结果 ==========')
  console.log('GD搜索:', songs.length > 0 ? '✅' : '❌')
  console.log('lx加载:', loadResult.ok.length > 0 ? '✅ (' + loadResult.ok.join(',') + ')' : '❌')
  console.log('VIP解析:', resolved ? '✅' : '❌')
  console.log('真实MP3:', isMp3 ? '✅' : '❌')
  fs.rmSync(dir, { recursive: true, force: true })
}

main().then(() => process.exit(0), e => { console.error('SMOKE FAILED:', e); process.exit(1) })
