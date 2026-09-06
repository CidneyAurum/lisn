import vm from 'node:vm'
import { UA } from '../spi'
import { withTimeout } from '../spi'

/**
 * MusicFree 插件沙箱宿主。
 * MusicFree 插件是 CommonJS 模块（module.exports），运行时可用 require('axios'|'he'|'crypto-js'|...)
 * 本宿主注入轻量垫片实现这些依赖（网络统一走 Node fetch）。
 */

// ---------- axios 垫片 ----------
interface AxiosConfig {
  method?: string
  url: string
  params?: Record<string, any>
  data?: any
  headers?: Record<string, string>
  responseType?: string
  timeout?: number
}
interface AxiosResp { data: any; status: number; statusText: string; headers: Record<string, string> }

async function axiosRequest(config: AxiosConfig): Promise<AxiosResp> {
  let url = config.url
  if (config.params && Object.keys(config.params).length) {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(config.params)) sp.set(k, String(v))
    url += (url.includes('?') ? '&' : '?') + sp.toString()
  }
  const headers: Record<string, string> = { 'User-Agent': UA, ...(config.headers ?? {}) }
  let body: any = undefined
  if (config.data != null) {
    if (typeof config.data === 'string') body = config.data
    else {
      body = JSON.stringify(config.data)
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
    }
  }
  const res = await withTimeout(fetch(url, { method: (config.method ?? 'get').toUpperCase(), headers, body, redirect: 'follow' }), config.timeout ?? 15000)
  const hdrs: Record<string, string> = {}
  res.headers.forEach((v, k) => { hdrs[k] = v })
  let data: any
  const text = await res.text()
  const ct = String(hdrs['content-type'] ?? '')
  if (config.responseType === 'text' || (!ct.includes('json') && !(text.trim().startsWith('{') || text.trim().startsWith('[')))) data = text
  else { try { data = JSON.parse(text) } catch { data = text } }
  return { data, status: res.status, statusText: res.statusText, headers: hdrs }
}

function makeAxios() {
  const inst: any = (config: AxiosConfig | string, maybeCfg?: AxiosConfig) => {
    if (typeof config === 'string') return axiosRequest({ ...(maybeCfg ?? {}), url: config })
    return axiosRequest(config)
  }
  inst.get = (url: string, cfg?: AxiosConfig) => axiosRequest({ ...(cfg ?? {}), url, method: 'get' })
  inst.post = (url: string, data: any, cfg?: AxiosConfig) => axiosRequest({ ...(cfg ?? {}), url, data, method: 'post' })
  inst.default = inst
  return inst
}

// ---------- he 垫片（HTML 实体解码） ----------
const HE_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&copy;': '©', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
  '&laquo;': '«', '&raquo;': '»', '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’'
}
function makeHe() {
  return {
    decode: (s: any) => String(s ?? '').replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&[a-zA-Z]+;|&#\d+;/g, (m: string) => HE_ENTITIES[m] ?? m),
    encode: (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
  }
}

// ---------- crypto-js 垫片（常用子集） ----------
function makeCryptoJs() {
  const crypto = require('node:crypto') as typeof import('node:crypto')
  const wrap = (alg: string) => ({
    update: (s: any) => ({
      toString: (enc?: string) => {
        const h = crypto.createHash(alg).update(String(s)).digest('hex')
        return enc === 'Base64' ? Buffer.from(h, 'hex').toString('base64') : h
      }
    })
  })
  return {
    MD5: (s: any) => wrap('md5').update(s),
    SHA1: (s: any) => wrap('sha1').update(s),
    SHA256: (s: any) => wrap('sha256').update(s),
    enc: { Hex: 'hex', Utf8: 'utf8', Base64: 'base64', Latin1: 'latin1' },
    AES: {
      encrypt: (data: any, key: any, cfg?: any) => {
        const mode = String(cfg?.mode ?? 'CBC').toUpperCase()
        const c = crypto.createCipheriv('aes-' + (String(key).length === 32 ? '256' : '128') + '-' + (mode === 'ECB' ? 'ecb' : 'cbc'), Buffer.from(String(key)), mode === 'ECB' ? null : Buffer.from(String(cfg?.iv ?? '')))
        return c.update(String(data), 'utf8', 'base64') + c.final('base64')
      }
    },
    mode: { CBC: 'CBC', ECB: 'ECB', CFB: 'CFB' },
    pad: { Pkcs7: 'Pkcs7' }
  }
}

// ---------- cheerio 垫片（最小 DOM：仅 load + 常用选择器文本提取） ----------
function makeCheerio() {
  // 极简实现：绝大多数音乐插件只用 $(html).find('tag').text() / .attr()
  const attrOf = (html: string, tag: string, attr?: string): string[] => {
    const out: string[] = []
    const re = new RegExp('<' + tag + '([^>]*)>([\s\S]*?)</' + tag + '>', 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      if (attr) {
        const a = m[1].match(new RegExp(attr + '=\\s*["\']([^"\']*)["\']', 'i'))
        out.push(a ? a[1] : '')
      } else out.push(m[2].replace(/<[^>]+>/g, '').trim())
    }
    return out
  }
  return {
    load: (html: string) => {
      const api: any = (sel: string) => {
        const tag = sel.replace(/^[.#]/, '').split(/[ .#:]/)[0] || sel
        const texts = attrOf(String(html), tag)
        return {
          text: () => texts.join(' '),
          html: () => texts.join(''),
          attr: (a: string) => attrOf(String(html), tag, a)[0] ?? '',
          each: (fn: (i: number, el: any) => void) => texts.forEach((t, i) => fn(i, { text: () => t })),
          length: texts.length,
          first: () => ({ text: () => texts[0] ?? '' }),
          find: (s2: string) => api(s2)
        }
      }
      api.text = () => String(html).replace(/<[^>]+>/g, '')
      api.html = () => html
      api.find = (s: string) => api(s)
      return api
    }
  }
}

export interface MusicFreePlugin {
  platform: string
  version?: string
  author?: string
  srcUrl?: string
  supportedSearchType?: string[]
  search?: (query: string, page: number, type: string) => Promise<{ isEnd: boolean; data: any[] }>
  getMediaSource?: (musicItem: any, quality: string) => Promise<{ url?: string; headers?: any }>
  getLyric?: (musicItem: any) => Promise<any>
  getMusicInfo?: (musicItem: any) => Promise<any>
  [k: string]: any
}

export class MusicFreeHost {
  plugin: MusicFreePlugin | null = null
  err: string | null = null

  constructor(public meta: { id: string; name: string }) {}

  load(code: string): void {
    const self = this
    const requireShim = (name: string): any => {
      switch (name) {
        case 'axios': return makeAxios()
        case 'he': return makeHe()
        case 'crypto-js': return makeCryptoJs()
        case 'cheerio': return makeCheerio()
        case 'qs': return { stringify: (o: any) => new URLSearchParams(Object.entries(o ?? {}).map(([k, v]) => [k, String(v)])).toString(), parse: (s: string) => Object.fromEntries(new URLSearchParams(s)) }
        case 'big-integer': return { BigInteger: (v: any) => ({ toString: () => String(v), multiply: (o: any) => ({ toString: () => String(Number(v) * Number(o)) }), mod: (o: any) => ({ toString: () => String(Number(v) % Number(o)) }) }) }
        case 'dayjs': return { default: (d?: any) => ({ format: () => String(d ?? new Date()) }) }
        default: throw new Error('MusicFree 宿主未提供依赖: ' + name)
      }
    }
    const sandbox: any = {
      module: { exports: {} as any },
      exports: {},
      require: requireShim,
      console: {
        log: (...a: any[]) => console.log('[mf:' + self.meta.id + ']', ...a.map(x => (typeof x === 'object' ? JSON.stringify(x)?.slice(0, 200) : String(x)))),
        warn: (...a: any[]) => console.warn('[mf:' + self.meta.id + ']', ...a.map(String)),
        error: (...a: any[]) => console.error('[mf:' + self.meta.id + ']', ...a.map(String))
      },
      setTimeout, clearTimeout, setInterval, clearInterval,
      Buffer, URL, URLSearchParams, TextEncoder, TextDecoder,
      fetch: (input: any, init?: any) => { const p = fetch(input, init); p.catch(() => {}); return p }
    }
    const ctx = vm.createContext(sandbox)
    vm.runInContext(code, ctx, { filename: 'musicfree-' + self.meta.id + '.js', timeout: 10000 })
    this.plugin = sandbox.module.exports ?? null
    if (!this.plugin?.platform) { this.err = '插件未导出 platform'; this.plugin = null }
  }

  /** 搜索 → 统一 Song（origin.platform 由调用方指定，如 kw） */
  async searchMusic(keyword: string, page: number, platform: string): Promise<{ isEnd: boolean; items: any[] }> {
    if (!this.plugin?.search) throw new Error('插件不支持搜索')
    const r = await withTimeout(Promise.resolve(this.plugin.search(keyword, page, 'music')), 20000)
    if (!r || !Array.isArray(r.data)) throw new Error('搜索返回结构异常')
    return { isEnd: !!r.isEnd, items: r.data }
  }

  async resolveUrl(musicItem: any, quality: string): Promise<string> {
    if (!this.plugin?.getMediaSource) throw new Error('插件不支持取流')
    const r = await withTimeout(Promise.resolve(this.plugin.getMediaSource(musicItem, quality)), 20000)
    if (!r?.url || typeof r.url !== 'string' || !/^https?:/.test(r.url)) throw new Error('插件未返回可用 URL')
    return r.url
  }

  async getLyric(musicItem: any): Promise<string | undefined> {
    if (!this.plugin?.getLyric) return undefined
    try {
      const r = await withTimeout(Promise.resolve(this.plugin.getLyric(musicItem)), 10000)
      if (r?.rawLrc) return String(r.rawLrc)
      return undefined
    } catch { return undefined }
  }
}
