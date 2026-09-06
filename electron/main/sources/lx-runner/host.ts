import vm from 'node:vm'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { UA } from '../spi'

// lx-music 自定义源协议事件名（官方文档协议）
export const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }

export interface LxRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: any
  form?: Record<string, string | number> | string
  timeout?: number
}

export interface LxResponse {
  statusCode: number
  headers: Record<string, string>
  body: any
}

type LxRequestCallback = (err: Error | null, resp?: LxResponse) => void

/** lx-music 宿主行为：JSON 响应自动解析为对象（脚本直接 body.code 访问） */
function autoParseBody(resp: LxResponse): LxResponse {
  if (typeof resp.body === 'string') {
    const ct = String(resp.headers?.['content-type'] ?? '')
    const t = resp.body.trim()
    if (ct.includes('json') || t.startsWith('{') || t.startsWith('[')) {
      try { resp.body = JSON.parse(t) } catch { /* keep string */ }
    }
  }
  return resp
}

export interface LxInitedSource {
  name: string
  type: string
  actions: string[]
  qualitys: string[]
}

export class LxScriptHost {
  requestHandler: ((payload: { source: string; action: string; info: { type: string; musicInfo: any } }) => Promise<any>) | null = null
  inited = false
  sources: Record<string, LxInitedSource> = {}
  private initedWaiters: Array<() => void> = []

  constructor(public meta: { id: string; name: string; version?: string }) {}

  private handleInited(data: any): void {
    this.sources = data?.sources ?? {}
    this.inited = true
    for (const w of this.initedWaiters.splice(0)) w()
  }

  waitInited(ms: number): Promise<void> {
    if (this.inited) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('脚本初始化超时(' + ms + 'ms): ' + this.meta.name)), ms)
      this.initedWaiters.push(() => { clearTimeout(timer); resolve() })
    })
  }

  run(code: string): void {
    const ctx = this.buildContext()
    vm.runInContext(code, ctx, { filename: 'lxsource-' + this.meta.id + '.js', timeout: 10000 })
  }

  async resolveMusicUrl(source: string, quality: string, musicInfo: any): Promise<string> {
    if (!this.requestHandler) throw new Error('脚本未注册 request 处理器: ' + this.meta.name)
    const url = await this.requestHandler({ source, action: 'musicUrl', info: { type: quality, musicInfo } })
    if (typeof url !== 'string' || !/^https?:/.test(url)) throw new Error('脚本返回非 URL: ' + this.meta.name)
    return url
  }

  private buildContext(): vm.Context {
    const self = this
    const tag = '[lx:' + self.meta.id + ']'

    const lxRequest = (url: string, options: LxRequestOptions, callback: LxRequestCallback): (() => void) => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(new Error('request timeout')), options?.timeout ?? 15000)
      const headers: Record<string, string> = { 'User-Agent': UA, ...(options?.headers ?? {}) }
      let body: any = options?.body
      if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
        body = JSON.stringify(body)
        if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
      } else if (options?.form && typeof options.form === 'object') {
        const sp = new URLSearchParams()
        for (const [k, v] of Object.entries(options.form)) sp.set(k, String(v))
        body = sp.toString()
        if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      fetch(url, {
        method: options?.method ?? 'GET',
        headers,
        body: (options?.method ?? 'GET').toUpperCase() === 'GET' ? undefined : body,
        signal: ac.signal,
        redirect: 'follow'
      })
        .then(async (res) => {
          clearTimeout(timer)
          const text = await res.text()
          const hdrs: Record<string, string> = {}
          res.headers.forEach((v, k) => { hdrs[k] = v })
          callback(null, autoParseBody({ statusCode: res.status, headers: hdrs, body: text }))
        })
        .catch((err) => {
          clearTimeout(timer)
          callback(err instanceof Error ? err : new Error(String(err)))
        })
      return () => ac.abort(new Error('cancelled'))
    }

    const con = (...args: any[]) => console.log(tag, ...args.map(a => (typeof a === 'object' ? JSON.stringify(a)?.slice(0, 300) : String(a))))
    const sandboxConsole = {
      log: con, info: con, debug: con,
      warn: (...a: any[]) => console.warn(tag, ...a.map(String)),
      error: (...a: any[]) => console.error(tag, ...a.map(a2 => (a2 instanceof Error ? a2.message : String(a2)))),
      group: con, groupCollapsed: con, groupEnd: () => {}
    }

    const lx = {
      EVENT_NAMES,
      env: 'desktop',
      version: '2.0.0',
      currentScriptInfo: { name: self.meta.name, version: self.meta.version ?? '', description: '', author: '', homepage: '' },
      on: (name: string, handler: any) => {
        if (name === EVENT_NAMES.request) self.requestHandler = handler
      },
      send: (name: string, data: any) => {
        if (name === EVENT_NAMES.inited) self.handleInited(data)
        else if (name === EVENT_NAMES.updateAlert) console.log(tag, 'updateAlert:', data?.description ?? '')
      },
      request: lxRequest,
      utils: {
        buffer: {
          from: (data: any, encoding?: any) => Buffer.from(data, encoding),
          bufToString: (buf: any, format?: any) => (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString(format ?? 'utf-8')
        },
        crypto: {
          aesEncrypt: (data: any, mode: string, key: any, iv: any) => {
            const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(String(key))
            const ivBuf = iv == null ? null : (Buffer.isBuffer(iv) ? iv : Buffer.from(String(iv)))
            const cipher = crypto.createCipheriv(mode, keyBuf, ivBuf as any)
            const plain = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
            return Buffer.concat([cipher.update(plain), cipher.final()])
          },
          aesDecrypt: (data: any, mode: string, key: any, iv: any) => {
            const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(String(key))
            const ivBuf = iv == null ? null : (Buffer.isBuffer(iv) ? iv : Buffer.from(String(iv)))
            const decipher = crypto.createDecipheriv(mode, keyBuf, ivBuf as any)
            const enc = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
            return Buffer.concat([decipher.update(enc), decipher.final()])
          },
          md5: (str: any) => crypto.createHash('md5').update(Buffer.isBuffer(str) ? str : String(str)).digest('hex'),
          randomBytes: (size: number) => crypto.randomBytes(size).toString('hex'),
          rsaEncrypt: (data: any, key: any) => {
            let pem = String(key)
            if (!pem.includes('-----BEGIN')) {
              pem = '-----BEGIN PUBLIC KEY-----\n' + (pem.match(/.{1,64}/g) ?? []).join('\n') + '\n-----END PUBLIC KEY-----'
            }
            return crypto.publicEncrypt(
              { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
              Buffer.isBuffer(data) ? data : Buffer.from(String(data))
            )
          }
        },
        zlib: {
          inflate: async (data: any) => zlib.inflateSync(Buffer.isBuffer(data) ? data : Buffer.from(data)),
          deflate: async (data: any) => zlib.deflateSync(Buffer.isBuffer(data) ? data : Buffer.from(data)),
          inflateRaw: async (data: any) => zlib.inflateRawSync(Buffer.isBuffer(data) ? data : Buffer.from(data))
        }
      }
    }

    const sandbox: any = {
      lx, console: sandboxConsole,
      setTimeout, clearTimeout, setInterval, clearInterval,
      Buffer, URL, URLSearchParams, TextEncoder, TextDecoder,
      fetch: (input: any, init?: any) => {
        const p = fetch(input, init)
        // 脚本可能不 await 直接调用：预挂吞错 catch，避免未处理 rejection 击穿宿主
        p.catch(() => {})
        return p
      }
    }
    return vm.createContext(sandbox)
  }
}
