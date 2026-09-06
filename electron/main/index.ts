import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { SourceRegistry } from './sources/registry'
import { LxSourceManager } from './sources/lx-runner/manager'
import { MusicFreeManager } from './sources/musicfree/manager'
import { SettingsStore } from './settings'
import { MediaServer } from './mediaServer'
import { DownloadManager } from './downloader'
import { PlaylistStore } from './playlists'
import { registerIpc } from './ipc'

let win: BrowserWindow | null = null

// lx 沙箱内脚本的异步网络失败（如 ikun 启动自检）可能产生未处理 rejection——只记日志，不影响应用
process.on('unhandledRejection', (reason) => {
  console.warn('[unhandledRejection]', String(reason).slice(0, 200))
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    backgroundColor: '#07090f',
    show: false,
    icon: path.join(app.getAppPath(), 'build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  // 开发期调试截图：GLASS_DEBUG_SHOT=1 时 2.5s 后截屏
  if (process.env.GLASS_DEBUG_SHOT === '1') {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win!.webContents.capturePage()
          fs.mkdirSync(path.join(app.getPath('userData'), 'debug'), { recursive: true })
          const p = path.join(app.getPath('userData'), 'debug', 'window.png')
          fs.writeFileSync(p, img.toPNG())
          console.log('[debug] screenshot saved: ' + p)
        } catch (e) { console.error('[debug] screenshot failed', e) }
      }, 2500)
    })
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => { win = null })
}

import fs from 'node:fs'

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const sourcesDir = path.join(userData, 'sources')
  const templatesPath = path.join(sourcesDir, 'http-templates.json')

  const settings = new SettingsStore(path.join(userData, 'settings.json'), path.join(app.getPath('music'), 'GlassMusic'))
  const mediaServer = new MediaServer()
  await mediaServer.start()

  const lx = new LxSourceManager(sourcesDir)
  await lx.init()
  const mf = new MusicFreeManager(sourcesDir)
  await mf.init()
  const registry = new SourceRegistry(lx, mf)
  registry.mode = settings.get().mode

  const broadcast = (channel: string, payload: any) => win?.webContents.send(channel, payload)
  const downloads = new DownloadManager(registry, settings, broadcast)
  const playlists = new PlaylistStore(path.join(userData, 'playlists.json'))

  registerIpc({
    getWin: () => win,
    registry, lx, mf, settings, downloads, mediaServer,
    templatesPath,
    playlists,
    broadcast
  })

  await createWindow()

  // 音源脚本加载（与窗口并行展示 UI）
  void Promise.all([lx.loadAll(), mf.loadAll()]).then(([lxR, mfR]) => {
    let templates: any[] = []
    try { templates = JSON.parse(fs.readFileSync(templatesPath, 'utf-8')).templates ?? [] } catch { /* ignore */ }
    registry.rebuild(templates)
    broadcast('sources:changed', {
      providers: registry.snapshot(), mode: registry.mode,
      lxEntries: lx.entries, mfEntries: mf.entries, templates, resolveOrder: lx.resolveOrder
    })
    console.log('[sources] lx loaded:', JSON.stringify(lxR.ok), 'failed:', JSON.stringify(lxR.failed))
    console.log('[sources] mf loaded:', JSON.stringify(mfR.ok), 'failed:', JSON.stringify(mfR.failed))
    if (settings.get().autoCheckUpdates) { void lx.checkUpdates(); void mf.checkUpdates() }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
