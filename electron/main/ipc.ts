import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SourceRegistry } from './sources/registry'
import { HttpSourceConfig } from './sources/http-generic'
import { LxSourceManager } from './sources/lx-runner/manager'
import { SettingsStore } from './settings'
import { MediaServer } from './mediaServer'
import { DownloadManager } from './downloader'
import { Song } from './sources/spi'
import { PlaylistStore } from './playlists'

export interface IpcDeps {
  getWin: () => BrowserWindow | null
  registry: SourceRegistry
  lx: LxSourceManager
  mf?: import('./sources/musicfree/manager').MusicFreeManager
  settings: SettingsStore
  downloads: DownloadManager
  mediaServer: MediaServer
  templatesPath: string
  playlists: PlaylistStore
  broadcast: (channel: string, payload: any) => void
}

function loadTemplates(p: string): HttpSourceConfig[] {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')).templates ?? [] } catch { return [] }
}
function saveTemplates(p: string, templates: HttpSourceConfig[]): void {
  fs.writeFileSync(p, JSON.stringify({ templates }, null, 2))
}

const DEFAULT_TEMPLATE: HttpSourceConfig = {
  id: 'http-huibq',
  name: 'Huibq 后端（HTTP 模板）',
  urlTemplate: 'https://lxmusicapi.onrender.com/url/{source}/{songId}/{quality}',
  headers: { 'X-Request-Key': 'share-v3' },
  jsonPath: 'url',
  platforms: ['kw', 'kg', 'tx', 'wy', 'mg'],
  qualities: ['320k', '128k'],
  enabled: false
}

export function registerIpc(deps: IpcDeps): void {
  const { registry, lx, settings, downloads, mediaServer } = deps

  const rebuildAndBroadcast = () => {
    let templates = loadTemplates(deps.templatesPath)
    if (!templates.length) { templates = [DEFAULT_TEMPLATE]; saveTemplates(deps.templatesPath, templates) }
    registry.rebuild(templates)
    deps.broadcast('sources:changed', sourcesSnapshot())
  }

  const sourcesSnapshot = () => ({
    providers: registry.snapshot(),
    mode: registry.mode,
    lxEntries: lx.entries,
    mfEntries: deps.mf?.entries ?? [],
    templates: loadTemplates(deps.templatesPath),
    resolveOrder: lx.resolveOrder
  })

  // ---------- 搜索 / 播放 ----------
  ipcMain.handle('search:aggregate', (_e, keyword: string, page?: number) =>
    registry.search(String(keyword ?? '').trim(), Math.max(1, Number(page) || 1)))
  ipcMain.handle('media:resolve', async (_e, payload: { song: Song; quality: string; pinnedProviderId?: string | null }) => {
    const res = await registry.resolveUrl(payload.song, payload.quality, { pinnedProviderId: payload.pinnedProviderId })
    return { ...res, streamUrl: mediaServer.streamUrlFor(res.url) }
  })
  ipcMain.handle('media:pic', (_e, song: Song) => registry.getPic(song))
  ipcMain.handle('media:lyric', (_e, song: Song) => registry.getLyric(song))

  // ---------- 下载 ----------
  ipcMain.handle('dl:enqueue', (_e, payload: { song: Song; quality: string }) => downloads.enqueue(payload.song, payload.quality))
  ipcMain.handle('dl:queue', () => downloads.queue)
  ipcMain.handle('dl:cancel', (_e, id: string) => downloads.cancel(id))
  ipcMain.handle('dl:retry', (_e, id: string) => downloads.retry(id))
  ipcMain.handle('dl:remove', (_e, id: string) => downloads.remove(id))
  ipcMain.handle('dl:clear', () => downloads.clearFinished())

  // ---------- 音源中心 ----------
  ipcMain.handle('sources:snapshot', () => sourcesSnapshot())
  ipcMain.handle('sources:setLxEnabled', (_e, payload: { id: string; enabled: boolean }) => {
    lx.setEnabled(payload.id, payload.enabled)
    rebuildAndBroadcast()
    return sourcesSnapshot()
  })
  ipcMain.handle('sources:reorder', (_e, order: string[]) => {
    lx.setResolveOrder(order)
    rebuildAndBroadcast()
    return sourcesSnapshot()
  })
  ipcMain.handle('sources:setMfEnabled', (_e, payload: { id: string; enabled: boolean }) => {
    deps.mf?.setEnabled(payload.id, payload.enabled)
    rebuildAndBroadcast()
    return sourcesSnapshot()
  })
  ipcMain.handle('sources:upgradeMf', async (_e, ids: string[]) => {
    const results: { id: string; ok: boolean; detail: string }[] = []
    for (const id of ids) {
      results.push({ id, ...(await deps.mf?.upgrade(id) ?? { ok: false, detail: 'MusicFree 管理器未初始化' }) })
    }
    rebuildAndBroadcast()
    return results
  })
  ipcMain.handle('sources:test', async (_e, id: string) => {
    const p = registry.providers.find(x => x.id === id)
    if (!p?.test) return { ok: false, detail: '该音源不支持测试' }
    return p.test()
  })
  ipcMain.handle('sources:checkUpdates', async () => {
    await lx.checkUpdates()
    await deps.mf?.checkUpdates()
    deps.broadcast('sources:changed', sourcesSnapshot())
    return sourcesSnapshot()
  })
  ipcMain.handle('sources:upgrade', async (_e, ids: string[]) => {
    const results: { id: string; ok: boolean; detail: string }[] = []
    for (const id of ids) {
      results.push({ id, ...(await lx.upgrade(id)) })
    }
    rebuildAndBroadcast()
    return results
  })
  ipcMain.handle('sources:rollback', (_e, id: string) => {
    const r = lx.rollback(id)
    void lx.reload(id)
    rebuildAndBroadcast()
    return r
  })
  ipcMain.handle('sources:addScript', async (_e, payload: { name: string; url: string }) => {
    const r = await lx.addCustom(payload.name, payload.url)
    rebuildAndBroadcast()
    return r
  })
  ipcMain.handle('sources:addHttp', (_e, config: HttpSourceConfig) => {
    const templates = loadTemplates(deps.templatesPath)
    templates.push({ ...DEFAULT_TEMPLATE, ...config })
    saveTemplates(deps.templatesPath, templates)
    rebuildAndBroadcast()
    return { ok: true, detail: '已添加 HTTP 音源模板' }
  })
  ipcMain.handle('sources:setHttpEnabled', (_e, payload: { id: string; enabled: boolean }) => {
    const templates = loadTemplates(deps.templatesPath)
    const t = templates.find(x => x.id === payload.id)
    if (t) { t.enabled = payload.enabled; saveTemplates(deps.templatesPath, templates) }
    rebuildAndBroadcast()
    return sourcesSnapshot()
  })
  ipcMain.handle('sources:setMode', (_e, mode: 'auto' | 'manual') => {
    registry.mode = mode
    settings.patch({ mode })
    deps.broadcast('sources:changed', sourcesSnapshot())
    return sourcesSnapshot()
  })

  // ---------- 自建歌单 ----------
  ipcMain.handle('pl:list', () => deps.playlists.list())
  ipcMain.handle('pl:create', (_e, name: string) => {
    const pl = deps.playlists.create(name)
    deps.broadcast('playlists:changed', deps.playlists.list())
    return pl
  })
  ipcMain.handle('pl:rename', (_e, payload: { id: string; name: string }) => {
    deps.playlists.rename(payload.id, payload.name)
    deps.broadcast('playlists:changed', deps.playlists.list())
  })
  ipcMain.handle('pl:export', (_e, id: string) => deps.playlists.exportJson(id))
  ipcMain.handle('pl:import', (_e, payload: { text: string }) => {
    const r = deps.playlists.importJson(payload.text)
    deps.broadcast('playlists:changed', deps.playlists.list())
    return r
  })
  ipcMain.handle('pl:delete', (_e, id: string) => {
    deps.playlists.delete(id)
    deps.broadcast('playlists:changed', deps.playlists.list())
  })
  ipcMain.handle('pl:addSong', (_e, payload: { id: string; song: Song }) => {
    const r = deps.playlists.addSong(payload.id, payload.song)
    deps.broadcast('playlists:changed', deps.playlists.list())
    return r
  })
  ipcMain.handle('pl:removeSong', (_e, payload: { id: string; songKey: string }) => {
    deps.playlists.removeSong(payload.id, payload.songKey)
    deps.broadcast('playlists:changed', deps.playlists.list())
  })
  ipcMain.handle('pl:saveFromSearch', (_e, payload: { name: string; keyword: string; songs: Song[] }) => {
    const pl = deps.playlists.saveFromSearch(payload.name, payload.keyword, payload.songs)
    deps.broadcast('playlists:changed', deps.playlists.list())
    return pl
  })

  // ---------- 设置 / 本地库 / 系统 ----------
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:patch', (_e, p: Partial<SettingsAll>) => {
    const next = settings.patch(p)
    if (p.mode) registry.mode = p.mode
    return next
  })
  ipcMain.handle('dialog:pickFolder', async () => {
    const win = deps.getWin()
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('library:scan', () => {
    const dir = settings.get().downloadDir
    const out: { filePath: string; name: string; artist: string; isFlac: boolean; size: number; mtime: number }[] = []
    try {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        if (!fs.statSync(full).isFile()) continue
        const m = f.match(/^(.+) - (.+)\.(mp3|flac)$/i)
        if (!m) continue
        const st = fs.statSync(full)
        out.push({ filePath: full, artist: m[1], name: m[2], isFlac: m[3].toLowerCase() === 'flac', size: st.size, mtime: st.mtimeMs })
      }
    } catch { /* 目录不存在 */ }
    out.sort((a, b) => b.mtime - a.mtime)
    return { dir, files: out }
  })
  ipcMain.handle('app:openPath', (_e, p: string) => {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) shell.showItemInFolder(p)
    else void shell.openPath(p)
  })
  ipcMain.handle('app:localStreamUrl', (_e, p: string) => mediaServer.localUrlFor(p))
  ipcMain.handle('app:version', () => '0.1.0')

  // ---------- 窗口控制 ----------
  ipcMain.on('win:minimize', () => deps.getWin()?.minimize())
  ipcMain.on('win:maximize', () => {
    const w = deps.getWin()
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('win:close', () => deps.getWin()?.close())
}

type SettingsAll = import('./settings').Settings
