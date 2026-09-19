import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useStore, getAudio } from '../stores/store'

export function SettingsView(): JSX.Element {
  const settings = useStore(s => s.settings)
  const showToast = useStore(s => s.showToast)
  const refreshSettings = useStore(s => s.refreshSettings)
  const refreshLibrary = useStore(s => s.refreshLibrary)
  const [dir, setDir] = useState('')

  useEffect(() => {
    void refreshSettings()
  }, [refreshSettings])

  useEffect(() => { if (settings) setDir(settings.downloadDir) }, [settings])

  if (!settings) return <div className="empty-state">加载设置…</div>

  const patch = async (p: Record<string, unknown>) => {
    await window.glass.patchSettings(p)
    await refreshSettings()
  }

  const pick = async () => {
    const d = await window.glass.pickFolder()
    if (d) { setDir(d); await patch({ downloadDir: d }); void refreshLibrary() }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="view-title">设置</div>
      <div className="view-sub">下载目录 · 音质偏好 · 解析模式 · 节流</div>

      <div className="song-list">
        <div className="setting-row">
          <div>
            <div className="setting-label">关于</div>
            <div className="setting-desc">聆 LISN v{__APP_VERSION__} · 聚合音源播放器 · 仅供个人学习试听</div>
            <div className="setting-desc" style={{ marginTop: 6 }}>
              GitHub: github.com/CidneyAurum/lisn · 📱 安卓版: lisn-mobile
            </div>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">下载目录</div>
            <div className="setting-desc">MP3/FLAC 与歌词 .lrc 的保存位置</div>
          </div>
          <div className="row">
            <input className="path-input" value={dir} onChange={e => setDir(e.target.value)} onBlur={() => { if (dir !== settings.downloadDir) void patch({ downloadDir: dir }) }} />
            <button className="mini-btn" onClick={() => void pick()}><FolderOpen size={13} /> 浏览</button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">播放模式</div>
            <div className="setting-desc">队列播完后的行为(单曲循环走无缝循环)</div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {([['loop', '列表循环'], ['shuffle', '随机'], ['one', '单曲循环']] as const).map(([m, label]) => (
                <button key={m} className={'mini-btn' + (settings.playMode === m ? ' primary' : '')} onClick={() => { void patch({ playMode: m }); getAudio().loop = (m === 'one') }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">默认音质</div>
            <div className="setting-desc">播放与下载的优先音质（自动降级：320k → 128k）</div>
          </div>
          <div className="segmented">
            {(['128k', '320k', 'flac'] as const).map(q => (
              <button key={q} className={'seg-btn' + (settings.quality === q ? ' on' : '')} onClick={() => void patch({ quality: q })}>
                {q.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">解析模式</div>
            <div className="setting-desc">智能自动：多源竞速自动切换；手动锁定：在播放条指定唯一音源</div>
          </div>
          <div className="segmented">
            <button className={'seg-btn' + (settings.mode === 'auto' ? ' on' : '')} onClick={() => { void patch({ mode: 'auto' }); void window.glass.setMode('auto') }}>智能自动</button>
            <button className={'seg-btn' + (settings.mode === 'manual' ? ' on' : '')} onClick={() => { void patch({ mode: 'manual' }); void window.glass.setMode('manual') }}>手动锁定</button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">下载节流间隔</div>
            <div className="setting-desc">单并发下载之间的等待毫秒数（防止免费音源封 IP，Huibq 建议 ≥2500ms）</div>
          </div>
          <div className="row">
            <input
              className="path-input"
              type="number" min={500} max={30000} step={500}
              defaultValue={settings.intervalMs}
              style={{ maxWidth: 130, textAlign: 'center' }}
              onBlur={e => { const v = Math.max(500, Math.min(30000, Number(e.target.value) || 2500)); void patch({ intervalMs: v }) }}
            />
            <span className="muted" style={{ fontSize: 12 }}>ms</span>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">启动时自动检查音源更新</div>
            <div className="setting-desc">后台查询 GitHub 仓库最新 commit（匿名 API 限 60 次/小时）</div>
          </div>
          <button className={'switch' + (settings.autoCheckUpdates ? ' on' : '')} onClick={() => void patch({ autoCheckUpdates: !settings.autoCheckUpdates })} />
        </div>
      </div>

      <div className="view-sub" style={{ marginTop: 20, lineHeight: 1.8 }}>
        琉璃音乐 GlassMusic v0.1.0 · 音源来自 GitHub 免费生态（Huibq/keep-alive · pdone/lx-music-source · GD音乐台）
        <br />仅供个人学习试听 · 请勿批量下载传播 · 音源接口版权归各平台所有
      </div>
    </div>
  )
}
