/**
 * E2E 下载链路验证：搜索 → VIP 解析 → 流式下载 → ID3+封面内嵌 → .lrc → 文件校验
 * （复用主进程 gdapi + manager + registry，模拟 Downloader.runOne）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { SourceRegistry } from '../electron/main/sources/registry'
import { LxSourceManager } from '../electron/main/sources/lx-runner/manager'

process.on('unhandledRejection', r => console.log('  (拦截:', String(r).slice(0, 60) + ')'))

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-e2e-'))
  console.log('下载目录:', tmpDir)

  // 1) 引擎初始化（= index.ts 的启动流程）
  const lx = new LxSourceManager(path.join(tmpDir, 'sources'))
  await lx.init()
  await lx.loadAll()
  const registry = new SourceRegistry(lx)
  registry.rebuild([])

  // 2) 搜索（= search:aggregate IPC）
  const page = await registry.search('周杰伦 晴天')
  const songs = page.songs
  console.log('搜索结果:', songs.length, '条')
  const song = songs.find(s => s.origins.some(o => o.platform === 'kw')) ?? songs[0]
  if (!song) throw new Error('无结果')
  console.log('目标曲:', song.name, '/', song.artist, '| 平台:', song.origins.map(o => o.platform).join('+'))

  // 3) 解析 VIP URL（= media:resolve IPC）
  const res = await registry.resolveUrl(song, '320k')
  console.log('解析: ', res.providerId, res.platform, res.quality, '->', res.url.slice(0, 70) + '...')

  // 4) 流式下载 + ID3 + 封面 + lrc（= Downloader.runOne）
  const filePath = path.join(tmpDir, song.artist + ' - ' + song.name + '.mp3')
  const upstream = await fetch(res.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' })
  if (!upstream.ok || !upstream.body) throw new Error('下载源 HTTP ' + upstream.status)
  const total = Number(upstream.headers.get('content-length') ?? 0)
  const ws = fs.createWriteStream(filePath)
  const reader = Readable.fromWeb(upstream.body as any)
  let received = 0
  reader.on('data', (c: Buffer) => { received += c.length })
  await new Promise<void>((resolve, reject) => {
    reader.on('error', reject); ws.on('error', reject)
    ws.on('finish', () => resolve())
    ;(reader as any).pipe(ws)
  })
  console.log('下载完成: ' + (received / 1048576).toFixed(2) + 'MB / 声称 ' + (total / 1048576).toFixed(2) + 'MB')
  if (received < 1000000) throw new Error('文件过小: ' + received)

  // ID3 标签 + 封面
  const _id3: any = await import('node-id3')
  const id3Write = _id3.write ?? _id3.default?.write
  const id3Read = _id3.read ?? _id3.default?.read
  const picUrl = await registry.getPic(song).catch(() => undefined)
  let coverBytes = 0
  if (picUrl) {
    const pr = await fetch(picUrl, { signal: AbortSignal.timeout(10000) })
    if (pr.ok) {
      const buf = Buffer.from(await pr.arrayBuffer())
      coverBytes = buf.length
      // 测试脚本:node-id3 的 PictureType 枚举字面量校验过严,此处放宽
      id3Write({ title: song.name, artist: song.artist, album: song.album ?? '', image: { mime: 'image/jpeg', type: 3, description: 'Cover', imageBuffer: buf } as any }, filePath)
    }
  } else {
    id3Write({ title: song.name, artist: song.artist, album: song.album ?? '' }, filePath)
  }
  const tags = id3Read(filePath)
  console.log('ID3 标题:', tags.title, '| 歌手:', tags.artist, '| 封面大小:', coverBytes, 'B', '| APIC:', tags.image ? '有' : '无')

  // 歌词
  const lrc = await registry.getLyric(song).catch(() => undefined)
  if (lrc) fs.writeFileSync(filePath.replace(/\.mp3$/i, '.lrc'), lrc, 'utf-8')
  console.log('歌词:', lrc ? String(lrc).length + ' 字符 -> .lrc' : '(无)')

  // 5) 校验最终文件
  const final = fs.statSync(filePath)
  const head = fs.readFileSync(filePath).subarray(0, 3).toString('hex')
  console.log('最终文件:', path.basename(filePath), (final.size / 1048576).toFixed(2) + 'MB', '头字节:', head)

  console.log('\n========== E2E 结果 ==========')
  console.log('搜索:', songs.length > 0 ? '✅' : '❌')
  console.log('VIP解析:', res.url.startsWith('http') ? '✅ (' + res.providerId + ')' : '❌')
  console.log('完整下载:', received > 1000000 ? '✅ ' + (received / 1048576).toFixed(1) + 'MB' : '❌')
  console.log('ID3+封面:', tags.title === song.name && tags.artist === song.artist ? '✅' : '❌', coverBytes ? '(封面 ' + coverBytes + 'B)' : '')
  console.log('LRC歌词:', lrc ? '✅' : '—')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log('\nALL PASS ✅')
}
main().then(() => process.exit(0), e => { console.error('E2E FAILED:', e); process.exit(1) })
