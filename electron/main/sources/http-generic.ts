import { SourceProvider, SongOrigin, SourceHealth, Platform, UA, markOk, markFail, withTimeout } from './spi'

/**
 * 通用 HTTP 音源模板 —— 预留接口的零代码接入形态。
 * 只需配置 URL 模板 + 鉴权头 + 响应 JSON 路径，即可接入任何
 * 形如 /url/{source}/{songId}/{quality} 的音源后端（如 Huibq 后端）。
 */
export interface HttpSourceConfig {
  id: string
  name: string
  urlTemplate: string                       // https://host/url/{source}/{songId}/{quality}
  headers?: Record<string, string>          // 如 { 'X-Request-Key': 'share-v3' }
  jsonPath?: string                         // 默认 'url'，支持 'a.b.c'
  platforms: Platform[]
  qualities?: string[]
  enabled?: boolean
}

function walkPath(obj: any, path: string): any {
  return path.split('.').reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), obj)
}

export class HttpGenericProvider implements SourceProvider {
  id: string
  name: string
  kind = 'http-api' as const
  caps: { platforms: Platform[]; qualities: string[]; supportsSearch: boolean }
  health: SourceHealth = { status: 'loading', okCount: 0, failCount: 0 }

  constructor(public config: HttpSourceConfig) {
    this.id = config.id
    this.name = config.name
    this.caps = { platforms: config.platforms, qualities: config.qualities ?? ['320k', '128k'], supportsSearch: false }
    this.health.status = config.enabled === false ? 'disabled' : 'loading'
  }

  async resolveUrl(origin: SongOrigin, quality: string): Promise<string> {
    const url = this.config.urlTemplate
      .replace('{source}', origin.platform)
      .replace('{songId}', origin.hash ?? origin.songId)
      .replace('{quality}', quality)
    const t0 = Date.now()
    const res = await withTimeout(fetch(url, {
      headers: { 'User-Agent': UA, ...(this.config.headers ?? {}) },
      signal: AbortSignal.timeout(15000)
    }), 15000)
    const text = await res.text()
    if (!res.ok) { markFail(this, 'HTTP ' + res.status); throw new Error('HTTP ' + res.status) }
    let val: any = text
    try { val = JSON.parse(text) } catch { /* 纯文本 URL */ }
    const out = typeof val === 'string' ? val : walkPath(val, this.config.jsonPath ?? 'url')
    if (typeof out !== 'string' || !/^https?:/.test(out)) { markFail(this, '无可用 URL'); throw new Error('响应中无可用 URL') }
    markOk(this, Date.now() - t0)
    return out
  }

  async test(): Promise<{ ok: boolean; detail: string }> {
    return { ok: this.health.status === 'ok', detail: this.health.lastError ?? '已就绪（等待首次解析验证）' }
  }
}
