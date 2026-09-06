const https = require('https')
const fs = require('fs')
function get(u, redirects) {
  return new Promise((resolve, reject) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(get(res.headers.location, redirects - 1)) }
      resolve(res)
    }).on('error', reject)
  })
}
async function main() {
  const url = 'https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
  console.log('GET', url)
  const res = await get(url, 5)
  if (res.statusCode !== 200) { console.error('HTTP ' + res.statusCode); process.exit(1) }
  const ws = fs.createWriteStream('winCodeSign-2.6.0.7z')
  res.pipe(ws)
  await new Promise(r => ws.on('finish', r))
  console.log('saved', fs.statSync('winCodeSign-2.6.0.7z').size, 'bytes')
}
main().catch(e => { console.error(e.message); process.exit(1) })
