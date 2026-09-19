import fs from 'node:fs'

export interface Settings {
  downloadDir: string
  quality: '128k' | '320k' | 'flac'
  mode: 'auto' | 'manual'
  intervalMs: number          // 下载节流（封 IP 防护）
  autoCheckUpdates: boolean   // 启动时自动检查音源 GitHub 更新
  playMode: 'loop' | 'one' | 'shuffle'  // 播放模式:列表循环/单曲循环/随机
  limbus?: { color: string; stroke: string; fontSize: number; glow: boolean; position: 'top' | 'center' | 'bottom' }  // 桌面歌词配置
  lyricSize?: number          // 全屏歌词字号 px(默认 16)
}

export class SettingsStore {
  data: Settings
  constructor(private file: string, defaultDownloadDir: string) {
    let loaded: Partial<Settings> = {}
    try { loaded = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { /* first run */ }
    // 默认值 + 已存字段整体合并(避免白名单漏字段导致设置不记忆)
    this.data = {
      downloadDir: defaultDownloadDir,
      quality: '320k',
      mode: 'auto',
      intervalMs: 2500,
      autoCheckUpdates: true,
      playMode: 'loop',
      ...loaded
    }
    this.save()
  }
  get(): Settings { return this.data }
  patch(p: Partial<Settings>): Settings {
    this.data = { ...this.data, ...p }
    this.save()
    return this.data
  }
  private save(): void {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)) } catch { /* ignore */ }
  }
}
