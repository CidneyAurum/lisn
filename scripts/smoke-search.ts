/**
 * 搜索完整性验证：GD 分页 + MusicFree 插件（全平台搜索源）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SourceRegistry } from '../electron/main/sources/registry'
import { LxSourceManager } from '../electron/main/sources/lx-runner/manager'
import { MusicFreeManager } from '../electron/main/sources/musicfree/manager'

process.on('unhandledRejection', r => console.log('  (拦截:', String(r).slice(0, 60) + ')'))

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-search-'))
  const lx = new LxSourceManager(path.join(dir, 'sources'))
  await lx.init()
  const mf = new MusicFreeManager(path.join(dir, 'sources'))
  await mf.init()
  const registry = new SourceRegistry(lx, mf)

  console.log('=== [1] 音源加载 ===')
  const [lxR, mfR] = await Promise.all([lx.loadAll(), mf.loadAll()])
  console.log('lx:', JSON.stringify(lxR.ok), '失败:', JSON.stringify(lxR.failed))
  console.log('mf:', JSON.stringify(mfR.ok), '失败:', JSON.stringify(mfR.failed))
  registry.rebuild([])
  console.log('providers:', registry.providers.map(p => p.id).join(', '))

  console.log('\n=== [2] 分页搜索「周杰伦」===')
  const p1 = await registry.search('周杰伦', 1)
  console.log('第1页累计:', p1.songs.length, '条 | hasMore:', p1.hasMore)
  const p2 = await registry.search('周杰伦', 2)
  console.log('第2页累计:', p2.songs.length, '条 | hasMore:', p2.hasMore)
  const p3 = await registry.search('周杰伦', 3)
  console.log('第3页累计:', p3.songs.length, '条 | hasMore:', p3.hasMore)

  console.log('\n=== [3] 平台覆盖 ===')
  const platCount: Record<string, number> = {}
  for (const s of p3.songs) for (const o of s.origins) platCount[o.platform] = (platCount[o.platform] ?? 0) + 1
  console.log('平台分布:', JSON.stringify(platCount))

  console.log('\n=== [4] VIP 曲解析验证（多平台试一首）===')
  const song = p1.songs.find(s => s.name === '晴天' && s.artist.includes('周杰伦')) ?? p1.songs[0]
  console.log('目标:', song.name, '/', song.artist, '| origins:', song.origins.map(o => o.platform + ':' + o.songId).join(' '))
  try {
    const res = await registry.resolveUrl(song, '320k')
    console.log('解析成功:', res.providerId, res.platform, res.quality)
    const head = await fetch(res.url, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-3' } })
    console.log('音频验证: HTTP', head.status, head.headers.get('content-type'), head.headers.get('content-range'))
  } catch (e) { console.log('解析失败:', String(e).slice(0, 120)) }

  console.log('\n========== 搜索完整性结果 ==========')
  console.log('GD翻页:', p2.songs.length > p1.songs.length ? '✅ (' + p1.songs.length + '→' + p2.songs.length + ')' : '❌')
  console.log('MusicFree加载:', mfR.ok.length > 0 ? '✅ (' + mfR.ok.join(',') + ')' : '❌')
  console.log('结果规模:', p3.songs.length >= 150 ? '✅ ' + p3.songs.length + '条' : '⚠ ' + p3.songs.length + '条（偏少）')
  fs.rmSync(dir, { recursive: true, force: true })
}
main().then(() => process.exit(0), e => { console.error('FAILED:', e); process.exit(1) })
