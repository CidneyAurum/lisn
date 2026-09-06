/**
 * 统一音源 SPI（Service Provider Interface）
 * 任何音源（GD API / lx 源脚本 / MusicFree 插件 / 通用 HTTP 模板 / 未来自定义）
 * 都实现此接口接入聚合层 —— 预留接口，未来音源即插即用。
 */

export type Platform = 'wy' | 'kw' | 'tx' | 'kg' | 'mg'

/** 平台侧歌曲定位信息：一个 Song 可携带多个平台 origin（聚合搜索合并） */
export interface SongOrigin {
  providerId: string          // 提供该元数据的音源 id
  platform: Platform | string // 平台
  songId: string              // 平台歌曲 id（kw rid / wy id / tx songmid / kg hash / mg copyrightId）
  hash?: string               // 酷狗 FileHash
  copyrightId?: string        // 咪咕 copyrightId
  extra?: Record<string, unknown> // picId / lyricId 等平台附加字段
}

/** 聚合后的统一歌曲模型 */
export interface Song {
  key: string                 // 合并键 name|artist
  name: string
  artist: string
  album?: string
  durationMs?: number
  origins: SongOrigin[]
  picUrl?: string             // 惰性解析后填充
}

/** 音源运行时状态（音源中心展示用） */
export interface SourceHealth {
  status: 'loading' | 'ok' | 'error' | 'disabled'
  latencyMs?: number
  okCount: number
  failCount: number
  lastError?: string
  lastOkAt?: number
}

/** 音源能力描述 */
export interface SourceCaps {
  platforms: Platform[]       // 可解析 URL 的平台
  qualities: string[]         // '128k' | '320k' | 'flac' | ...
  supportsSearch: boolean
}

/**
 * 音源 Provider 接口 —— 所有 kind 的最终形态。
 * kind: 'gd' | 'lx-script' | 'musicfree-plugin' | 'http-api' | 'custom'
 */
export interface SourceProvider {
  id: string
  name: string
  kind: 'gd' | 'lx-script' | 'musicfree-plugin' | 'http-api' | 'custom'
  caps: SourceCaps
  health: SourceHealth

  search?(keyword: string, page: number): Promise<Song[]>
  resolveUrl(origin: SongOrigin, quality: string): Promise<string>
  getPic?(origin: SongOrigin): Promise<string | undefined>
  getLyric?(origin: SongOrigin): Promise<string | undefined>
  /** 音源中心"测试"按钮：对给定平台+id 试解析 128k */
  test?(): Promise<{ ok: boolean; detail: string }>
  dispose?(): void
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export function markOk(p: SourceProvider, latencyMs: number): void {
  p.health.status = 'ok'; p.health.latencyMs = latencyMs; p.health.okCount++
  p.health.lastOkAt = Date.now(); p.health.lastError = undefined
}
export function markFail(p: SourceProvider, err: unknown): void {
  p.health.failCount++
  p.health.lastError = err instanceof Error ? err.message : String(err)
  if (p.health.status !== 'disabled') p.health.status = 'error'
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}
