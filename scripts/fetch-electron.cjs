// 从 npmmirror 下载 electron zip（Node 直连，绕过 postinstall 静默失败）
const https = require('https')
const fs = require('fs')
const path = require('path')

const VERSION = '33.2.0'
const zipPath = path.join(__dirname, 'electron-' + VERSION + '-win32-x64.zip')
const url = 'https://npmmirror.com/mirrors/electron/' + VERSION + '/electron-v' + VERSION + '-win32-x64.zip'

function get(u, redirects) {
  return new Promise((resolve, reject) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        return resolve(get(res.headers.location, redirects - 1))
      }
      resolve(res)
    }).on('error', reject)
  })
}

async function main() {
  console.log('GET', url)
  const res = await get(url, 5)
  console.log('status', res.statusCode)
  if (res.statusCode !== 200) { console.error('FAIL: HTTP ' + res.statusCode); process.exit(1) }
  const total = +(res.headers['content-length'] ?? 0)
  let got = 0
  const ws = fs.createWriteStream(zipPath)
  res.pipe(ws)
  res.on('data', c => {
    got += c.length
    if (got % (20 * 1024 * 1024) < c.length) console.log('  ' + (got / 1048576).toFixed(0) + '/' + (total / 1048576).toFixed(0) + 'MB')
  })
  await new Promise((resolve, reject) => { ws.on('finish', resolve); ws.on('error', reject) })
  console.log('SAVED', got, 'bytes ->', zipPath)
}
main().catch(e => { console.error('ERR', e.message); process.exit(1) })
