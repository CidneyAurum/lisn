import fs from 'node:fs'

export interface Settings {
  downloadDir: string
  quality: '128k' | '320k' | 'flac'
  mode: 'auto' | 'manual'
  intervalMs: number          // 下载节流（封 IP 防护）
  autoCheckUpdates: boolean   // 启动时自动检查音源 GitHub 更新
  playMode: 'loop' | 'one' | 'shuffle'  // 播放模式:列表循环/单曲循环/随机
}

export class SettingsStore {
  data: Settings
  constructor(private file: string, defaultDownloadDir: string) {
    let loaded: Partial<Settings> = {}
    try { loaded = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { /* first run */ }
    this.data = {
      downloadDir: loaded.downloadDir ?? defaultDownloadDir,
      quality: loaded.quality ?? '320k',
      mode: loaded.mode ?? 'auto',
      intervalMs: loaded.intervalMs ?? 2500,
      autoCheckUpdates: loaded.autoCheckUpdates ?? true,
      playMode: loaded.playMode ?? 'loop'
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
