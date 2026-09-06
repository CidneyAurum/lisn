import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MusicFreeManager } from '../electron/main/sources/musicfree/manager'
process.on('unhandledRejection', r => console.log('  (拦截:', String(r).slice(0, 70) + ')'))

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-mf-'))
  const mf = new MusicFreeManager(path.join(dir, 'sources'))
  await mf.init()
  // 全部启用（含 xiaomi）
  for (const e of mf.entries) e.enabled = true
  await mf.loadAll()

  for (const id of ['xiaowo', 'xiaogou', 'xiaoqiu', 'xiaoyun', 'xiaomi']) {
    const entry = mf.entries.find(e => e.id === id)!
    const p = mf.providerFor(entry)
    if (!p) { console.log(id + ': 未加载'); continue }
    try {
      const songs = await p.search('周杰伦', 1)
      console.log(id + ' (' + entry.platform + '):', songs.length, '条 | 首条:', songs[0] ? songs[0].name + ' / ' + songs[0].artist + ' [id=' + songs[0].origins[0].songId.slice(0, 20) + ']' : '无')
      // 试解析第一条
      if (songs[0]) {
        try {
          const url = await p.resolveUrl(songs[0].origins[0], '320k')
          const head = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-3' } })
          console.log('   解析: HTTP', head.status, head.headers.get('content-type'), (head.headers.get('content-range') ?? '').split('/').pop())
        } catch (e) { console.log('   解析失败:', String(e).slice(0, 100)) }
      }
    } catch (e) { console.log(id + ': 搜索失败 -', String(e).slice(0, 130)) }
  }
  fs.rmSync(dir, { recursive: true, force: true })
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
