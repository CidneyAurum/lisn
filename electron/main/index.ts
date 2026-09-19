import { app, BrowserWindow, Tray, Menu } from 'electron'
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
let quitting = false

// 单实例锁:二次启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus() }
  })
}
let tray: Tray | null = null

// lx 沙箱内脚本的异步网络失败（如 ikun 启动自检）可能产生未处理 rejection——只记日志，不影响应用
process.on('unhandledRejection', (reason) => {
  console.warn('[unhandledRejection]', String(reason).slice(0, 200))
})
// 未捕获异常同样兜底（如 AbortSignal 超时）：记日志不弹 GUI 错误框，避免打扰
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack ?? String(err))
})

function loadBounds(): { width: number; height: number; x?: number; y?: number } {
  try {
    const f = path.join(app.getPath('userData'), 'window-state.json')
    const b = JSON.parse(fs.readFileSync(f, 'utf-8'))
    if (b.width >= 1120 && b.height >= 720) return b
  } catch { /* 首次运行 */ }
  return { width: 1440, height: 920 }
}

function createWindow(): void {
  const bounds = loadBounds()
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x != null ? { x: bounds.x, y: bounds.y } : {}),
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
  // 关闭按钮 → 最小化到托盘(托盘菜单/再次点击退出)
  win.on('close', (e) => {
    try {
      const b = win?.getBounds()
      if (b) fs.writeFileSync(path.join(app.getPath('userData'), 'window-state.json'), JSON.stringify(b))
    } catch { /* ignore */ }
    if (!quitting && tray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => { win = null })
}

import fs from 'node:fs'

// 开发期 CDP 调试通道:LISN_CDP_PORT=9222 pnpm dev → 渲染进程可程序化验证
if (!app.isPackaged && process.env.LISN_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.LISN_CDP_PORT)
}

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

  // 系统托盘
  try {
    const iconPath = path.join(app.getAppPath(), 'build/icon.png')
    tray = new Tray(iconPath)
    tray.setToolTip('聆 LISN')
    const showWin = () => { win?.show(); win?.focus() }
    tray.on('click', showWin)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主界面', click: showWin },
      { type: 'separator' },
      { label: '播放 / 暂停', click: () => win?.webContents.send('tray:control', 'toggle') },
      { label: '下一首', click: () => win?.webContents.send('tray:control', 'next') },
      { label: '上一首', click: () => win?.webContents.send('tray:control', 'prev') },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit() } }
    ]))
  } catch (e) {
    console.warn('[tray] 初始化失败(不影响主功能)', e)
  }

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

app.on('before-quit', () => { quitting = true })

app.on('window-all-closed', () => {
  app.quit()
})
