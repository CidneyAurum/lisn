import { contextBridge, ipcRenderer } from 'electron'

const overlayBridge = {
  onConfig: (cb: (cfg: any) => void) => {
    const l = (_e: unknown, cfg: unknown) => cb(cfg)
    ipcRenderer.on('limbus:config', l)
    return () => ipcRenderer.removeListener('limbus:config', l)
  },
  onLyrics: (cb: (data: unknown) => void) => {
    const l = (_e: unknown, data: unknown) => cb(data)
    ipcRenderer.on('overlay:lyrics', l)
    return () => ipcRenderer.removeListener('overlay:lyrics', l)
  },
  onPos: (cb: (sec: number) => void) => {
    const l = (_e: unknown, sec: number) => cb(sec)
    ipcRenderer.on('overlay:pos', l)
    return () => ipcRenderer.removeListener('overlay:pos', l)
  }
}
const overlayControls = {
  ready: () => ipcRenderer.send('overlay:ready'),
  setLocked: (v: boolean) => ipcRenderer.send('limbus:setLocked', v)
}

const api = {
  search: (keyword: string, page?: number) => ipcRenderer.invoke('search:aggregate', keyword, page),
  resolve: (song: unknown, quality: string, pinnedProviderId?: string | null) =>
    ipcRenderer.invoke('media:resolve', { song, quality, pinnedProviderId }),
  pic: (song: unknown) => ipcRenderer.invoke('media:pic', song),
  lyric: (song: unknown) => ipcRenderer.invoke('media:lyric', song),

  enqueue: (song: unknown, quality: string) => ipcRenderer.invoke('dl:enqueue', { song, quality }),
  queue: () => ipcRenderer.invoke('dl:queue'),
  cancelDl: (id: string) => ipcRenderer.invoke('dl:cancel', id),
  retryDl: (id: string) => ipcRenderer.invoke('dl:retry', id),
  removeDl: (id: string) => ipcRenderer.invoke('dl:remove', id),
  clearDl: () => ipcRenderer.invoke('dl:clear'),

  sources: () => ipcRenderer.invoke('sources:snapshot'),
  setLxEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('sources:setLxEnabled', { id, enabled }),
  setMfEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('sources:setMfEnabled', { id, enabled }),
  upgradeMfSources: (ids: string[]) => ipcRenderer.invoke('sources:upgradeMf', ids),
  setHttpEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('sources:setHttpEnabled', { id, enabled }),
  reorderSources: (order: string[]) => ipcRenderer.invoke('sources:reorder', order),
  testSource: (id: string) => ipcRenderer.invoke('sources:test', id),
  checkUpdates: () => ipcRenderer.invoke('sources:checkUpdates'),
  upgradeSources: (ids: string[]) => ipcRenderer.invoke('sources:upgrade', ids),
  rollbackSource: (id: string) => ipcRenderer.invoke('sources:rollback', id),
  addScriptSource: (name: string, url: string) => ipcRenderer.invoke('sources:addScript', { name, url }),
  addHttpSource: (config: unknown) => ipcRenderer.invoke('sources:addHttp', config),
  setMode: (mode: 'auto' | 'manual') => ipcRenderer.invoke('sources:setMode', mode),

  // 自建歌单
  plList: () => ipcRenderer.invoke('pl:list'),
  plCreate: (name: string) => ipcRenderer.invoke('pl:create', name),
  plDelete: (id: string) => ipcRenderer.invoke('pl:delete', id),
  plExport: (id: string) => ipcRenderer.invoke('pl:export', id) as Promise<string | null>,
  plImport: (text: string) => ipcRenderer.invoke('pl:import', { text }) as Promise<{ ok: boolean; detail: string }>,
  plRename: (id: string, name: string) => ipcRenderer.invoke('pl:rename', { id, name }),
  plAddSong: (id: string, song: unknown) => ipcRenderer.invoke('pl:addSong', { id, song }),
  plRemoveSong: (id: string, songKey: string) => ipcRenderer.invoke('pl:removeSong', { id, songKey }),
  plSaveFromSearch: (name: string, keyword: string, songs: unknown[]) => ipcRenderer.invoke('pl:saveFromSearch', { name, keyword, songs }),
  onPlaylistsChanged: (cb: (list: unknown[]) => void) => {
    const listener = (_e: unknown, list: unknown[]) => cb(list)
    ipcRenderer.on('playlists:changed', listener)
    return () => ipcRenderer.removeListener('playlists:changed', listener)
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  patchSettings: (p: unknown) => ipcRenderer.invoke('settings:patch', p),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  libraryScan: () => ipcRenderer.invoke('library:scan'),
  openPath: (p: string) => ipcRenderer.invoke('app:openPath', p),
  localStreamUrl: (p: string) => ipcRenderer.invoke('app:localStreamUrl', p),

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),

  onTrayControl: (cb: (action: string) => void) => {
    const listener = (_e: unknown, action: string) => cb(action)
    ipcRenderer.on('tray:control', listener)
    return () => ipcRenderer.removeListener('tray:control', listener)
  },
  limbusToggle: () => ipcRenderer.invoke('limbus:toggle') as Promise<boolean>,
  overlaySetConfig: (cfg: unknown) => ipcRenderer.send('limbus:setConfig', cfg),
  onLimbusConfig: (cb: (cfg: any) => void) => {
    const l = (_e: unknown, cfg: any) => cb(cfg)
    ipcRenderer.on('limbus:config', l)
    return () => ipcRenderer.removeListener('limbus:config', l)
  },
  onOverlayRepush: (cb: () => void) => {
    const l = () => cb()
    ipcRenderer.on('overlay:repush', l)
    return () => ipcRenderer.removeListener('overlay:repush', l)
  },
  onLimbusState: (cb: (visible: boolean) => void) => {
    const l = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('limbus:state', l)
    return () => ipcRenderer.removeListener('limbus:state', l)
  },
  overlayPushLyrics: (data: unknown) => ipcRenderer.send('overlay:lyrics', data),
  overlayPushPos: (sec: number) => ipcRenderer.send('overlay:pos', sec),
  overlaySetPos: (pos: string) => ipcRenderer.send('limbus:setPos', pos),
  onQueue: (cb: (items: unknown[]) => void) => {
    const listener = (_e: unknown, items: unknown[]) => cb(items)
    ipcRenderer.on('dl:queue', listener)
    return () => ipcRenderer.removeListener('dl:queue', listener)
  },
  onSourcesChanged: (cb: (snapshot: unknown) => void) => {
    const listener = (_e: unknown, snap: unknown) => cb(snap)
    ipcRenderer.on('sources:changed', listener)
    return () => ipcRenderer.removeListener('sources:changed', listener)
  }
}

contextBridge.exposeInMainWorld('glass', api)
contextBridge.exposeInMainWorld('overlayBridge', overlayBridge)
contextBridge.exposeInMainWorld('overlayControls', overlayControls)

export type GlassApi = typeof api
