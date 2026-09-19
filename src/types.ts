export interface SongOrigin {
  providerId: string
  platform: string
  songId: string
  hash?: string
  copyrightId?: string
  extra?: Record<string, unknown>
}

export interface Song {
  key: string
  name: string
  artist: string
  album?: string
  durationMs?: number
  origins: SongOrigin[]
  picUrl?: string
}

export interface SourceHealth {
  status: 'loading' | 'ok' | 'error' | 'disabled'
  latencyMs?: number
  okCount: number
  failCount: number
  lastError?: string
  lastOkAt?: number
}

export interface ProviderSnapshot {
  id: string
  name: string
  kind: 'gd' | 'lx-script' | 'musicfree-plugin' | 'http-api' | 'custom'
  caps: { platforms: string[]; qualities: string[]; supportsSearch: boolean }
  health: SourceHealth
}

export interface LxEntrySnap {
  id: string
  name: string
  enabled: boolean
  repo?: string
  file?: string
  rawUrl?: string
  localVersion?: string
  remoteDate?: string
}

export interface HttpTemplateSnap {
  id: string
  name: string
  urlTemplate: string
  enabled?: boolean
}

export interface SourcesSnapshot {
  providers: ProviderSnapshot[]
  mode: 'auto' | 'manual'
  lxEntries: LxEntrySnap[]
  mfEntries: MfEntrySnap[]
  templates: HttpTemplateSnap[]
  resolveOrder: string[]
}

export interface DownloadItem {
  id: string
  name: string
  artist: string
  album?: string
  quality: string
  status: 'waiting' | 'resolving' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  progress: number
  received: number
  total: number
  filePath?: string
  error?: string
  sourceId?: string
  platform?: string
  createdAt: number
}

export interface Settings {
  downloadDir: string
  quality: '128k' | '320k' | 'flac'
  mode: 'auto' | 'manual'
  intervalMs: number
  autoCheckUpdates: boolean
  playMode: 'loop' | 'one' | 'shuffle'
}

export interface LibraryFile {
  filePath: string
  name: string
  artist: string
  isFlac: boolean
  size: number
  mtime: number
}

export interface SearchPage {
  songs: Song[]
  hasMore: boolean
  page: number
}

export interface MfEntrySnap {
  id: string
  name: string
  platform: string
  enabled: boolean
  repo?: string
  version?: string
  remoteDate?: string
}

export interface UserPlaylist {
  id: string
  name: string
  createdAt: number
  keyword?: string
  songs: Song[]
}

export interface GlassApi {
  search(keyword: string, page?: number): Promise<SearchPage>
  resolve(song: Song, quality: string, pinnedProviderId?: string | null): Promise<{ url: string; streamUrl: string; providerId: string; platform: string; quality: string }>
  pic(song: Song): Promise<string | undefined>
  lyric(song: Song): Promise<string | undefined>
  enqueue(song: Song, quality: string): Promise<DownloadItem>
  queue(): Promise<DownloadItem[]>
  cancelDl(id: string): Promise<void>
  retryDl(id: string): Promise<void>
  removeDl(id: string): Promise<void>
  clearDl(): Promise<void>
  sources(): Promise<SourcesSnapshot>
  setLxEnabled(id: string, enabled: boolean): Promise<SourcesSnapshot>
  setMfEnabled(id: string, enabled: boolean): Promise<SourcesSnapshot>
  upgradeMfSources(ids: string[]): Promise<{ id: string; ok: boolean; detail: string }[]>
  setHttpEnabled(id: string, enabled: boolean): Promise<SourcesSnapshot>
  reorderSources(order: string[]): Promise<SourcesSnapshot>
  testSource(id: string): Promise<{ ok: boolean; detail: string }>
  checkUpdates(): Promise<SourcesSnapshot>
  upgradeSources(ids: string[]): Promise<{ id: string; ok: boolean; detail: string }[]>
  rollbackSource(id: string): Promise<{ ok: boolean; detail: string }>
  addScriptSource(name: string, url: string): Promise<{ ok: boolean; detail: string; id?: string }>
  addHttpSource(config: unknown): Promise<{ ok: boolean; detail: string }>
  setMode(mode: 'auto' | 'manual'): Promise<SourcesSnapshot>
  plList(): Promise<UserPlaylist[]>
  plCreate(name: string): Promise<UserPlaylist>
  plDelete(id: string): Promise<void>
  plExport(id: string): Promise<string | null>
  plImport(text: string): Promise<{ ok: boolean; detail: string }>
  plRename(id: string, name: string): Promise<void>
  plAddSong(id: string, song: Song): Promise<{ ok: boolean; detail: string }>
  plRemoveSong(id: string, songKey: string): Promise<void>
  plSaveFromSearch(name: string, keyword: string, songs: Song[]): Promise<UserPlaylist>
  onPlaylistsChanged(cb: (list: UserPlaylist[]) => void): () => void

  getSettings(): Promise<Settings>
  patchSettings(p: Partial<Settings>): Promise<Settings>
  pickFolder(): Promise<string | null>
  libraryScan(): Promise<{ dir: string; files: LibraryFile[] }>
  openPath(p: string): Promise<void>
  localStreamUrl(p: string): Promise<string>
  minimize(): void
  maximize(): void
  close(): void
  onQueue(cb: (items: DownloadItem[]) => void): () => void
  onSourcesChanged(cb: (snapshot: SourcesSnapshot) => void): () => void
}

declare global {
  interface Window { glass: GlassApi }
}
