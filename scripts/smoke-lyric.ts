/**
 * 歌词链路冒烟:GD 网易歌 → registry.getLyric → LRC 文本
 * 运行:npx tsx scripts/smoke-lyric.ts
 */
import { GdProvider } from '../electron/main/sources/gdapi'

async function main(): Promise<void> {
  const gd = new GdProvider()
  const songs = await gd.search('晴天')
  const wy = songs.find(s => s.origins.some(o => o.platform === 'wy'))
  if (!wy) throw new Error('无网易结果')
  const origin = wy.origins.find(o => o.platform === 'wy')!
  console.log('目标曲:', wy.name, '/', wy.artist)
  const lrc = await gd.getLyric(origin)
  if (!lrc || lrc.length < 50) throw new Error('歌词为空或过短: ' + String(lrc).slice(0, 60))
  const lines = lrc.split('\n').filter(l => l.trim()).length
  console.log('歌词获取成功:', lines, '行 | 首行:', lrc.split('\n').find(l => l.trim())?.slice(0, 50))
  if (!/\[\d{1,3}[:.]/.test(lrc)) throw new Error('歌词无时间戳(非 LRC?)')
  console.log('SMOKE OK')
}

main().catch(e => { console.error('SMOKE FAILED:', e.message); process.exit(1) })
