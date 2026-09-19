import { useEffect, useMemo, useState } from 'react'
import { Radio, RefreshCw, ArrowUp, ArrowDown, Plus, ChevronDown, Link2, Zap, TestTube, RotateCcw, Loader2 } from 'lucide-react'
import { useStore } from '../stores/store'
import type { ProviderSnapshot, LxEntrySnap } from '../types'
import { motion, AnimatePresence } from 'framer-motion'

const KIND_LABEL: Record<string, string> = {
  gd: 'GD API', 'lx-script': 'lx 源脚本', 'musicfree-plugin': 'MusicFree', 'http-api': 'HTTP 模板', custom: '自定义'
}
const KIND_COLOR: Record<string, string> = {
  gd: 'linear-gradient(135deg,#86cecb,#137a7f)',
  'lx-script': 'linear-gradient(135deg,#e12885,#ff9ec2)',
  'musicfree-plugin': 'linear-gradient(135deg,#39c5bb,#86cecb)',
  'http-api': 'linear-gradient(135deg,#ffb340,#e12885)',
  custom: 'linear-gradient(135deg,#e12885,#86cecb)'
}

function statusOf(p: ProviderSnapshot): 'ok' | 'error' | 'loading' | 'disabled' {
  return p.health.status
}

function okRate(p: ProviderSnapshot): string {
  const total = p.health.okCount + p.health.failCount
  if (!total) return '—'
  return Math.round((p.health.okCount / total) * 100) + '%'
}

export function SourceCenterView(): JSX.Element {
  const sources = useStore(s => s.sources)
  const showToast = useStore(s => s.showToast)
  const refreshSources = useStore(s => s.refreshSources)
  const [busy, setBusy] = useState(false)
  const [upgrading, setUpgrading] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => { if (!sources) void refreshSources() }, [sources, refreshSources])

  const providers = useMemo(() => sources?.providers ?? [], [sources])
  const order = sources?.resolveOrder ?? providers.map(p => p.id)
  const lxEntries = sources?.lxEntries ?? []
  const mfEntries = sources?.mfEntries ?? []
  const templates = sources?.templates ?? []

  // 升级徽章：lx 条目有 remoteDate 且比缓存时间新
  const hasUpdate = (providerId: string): boolean => {
    const entryId = providerId.startsWith('lx:') ? providerId.slice(3) : providerId
    const e = lxEntries.find(x => x.id === entryId)
    return false // 由 checkUpdates 后对比 localVersion 判定（v1 简化：显示版本即可）
  }

  const move = async (id: string, dir: -1 | 1) => {
    if (!sources) return
    const cur = [...order]
    const idx = cur.indexOf(id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= cur.length) return
    ;[cur[idx], cur[swap]] = [cur[swap], cur[idx]]
    useStore.setState({ sources: await window.glass.reorderSources(cur) })
  }

  const doCheckUpdates = async () => {
    setBusy(true)
    try {
      useStore.setState({ sources: await window.glass.checkUpdates() })
      showToast('已检查 GitHub 仓库更新（版本时间已刷新）')
    } finally { setBusy(false) }
  }

  const doUpgrade = async (providerId: string) => {
    const isMf = providerId.startsWith('mf:')
    const entryId = isMf ? providerId.slice(3) : providerId.startsWith('lx:') ? providerId.slice(3) : providerId
    setUpgrading(new Set(upgrading).add(entryId))
    try {
      const results = isMf ? await window.glass.upgradeMfSources([entryId]) : await window.glass.upgradeSources([entryId])
      const r = results[0]
      showToast(r.ok ? '已升级：' + r.detail : '升级失败：' + r.detail)
      useStore.setState({ sources: await window.glass.sources() })
    } finally {
      const s = new Set(upgrading); s.delete(entryId); setUpgrading(s)
    }
  }

  const doTest = async (id: string) => {
    const r = await window.glass.testSource(id)
    showToast((r.ok ? '✓ ' : '✗ ') + id + '：' + r.detail)
  }

  const [testingAll, setTestingAll] = useState(false)
  const doTestAll = async () => {
    if (!sources) return
    setTestingAll(true)
    let okCount = 0
    const total = sources.providers.length
    for (const p of sources.providers) {
      try {
        const r = await window.glass.testSource(p.id)
        if (r.ok) okCount++
        showToast((r.ok ? '✓ ' : '✗ ') + p.name + '：' + r.detail)
        await new Promise(res => setTimeout(res, 400))
      } catch { /* 单源失败继续 */ }
    }
    setTestingAll(false)
    showToast(`全部测试完成：${okCount}/${total} 可用`)
    await refreshSources()
  }

  if (!sources) return <div className="empty-state">加载音源信息…</div>

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* 顶部：模式切换 + 检查更新 */}
      <div className="row" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div className="view-title" style={{ margin: 0 }}>音源中心</div>
          <div className="view-sub" style={{ margin: '4px 0 0' }}>解析模式 · 优先级链路 · GitHub 同步升级</div>
        </div>
        <div className="spacer" />
        <button className="mini-btn" disabled={testingAll} onClick={() => void doTestAll()} title="逐个测试所有音源">
          {testingAll ? <Loader2 size={12} className="spin" /> : <TestTube size={12} />} 全部测试
        </button>
        <div className="segmented">
          <button className={'seg-btn' + (sources.mode === 'auto' ? ' on' : '')} onClick={() => useStore.setState({ sources: sources ? { ...sources, mode: 'auto' } : sources })}>
            智能自动
          </button>
          <button className={'seg-btn' + (sources.mode === 'manual' ? ' on' : '')} onClick={async () => { useStore.setState({ sources: await window.glass.setMode('manual') }) }}>
            手动锁定
          </button>
        </div>
        <button className="mini-btn" disabled={busy} onClick={doCheckUpdates}>
          <RefreshCw size={13} className={busy ? 'spin' : ''} /> 检查更新
        </button>
        <button className="mini-btn primary" onClick={() => setShowAdd(v => !v)}>
          <Plus size={13} /> 添加音源
        </button>
      </div>

      {/* 模式说明 */}
      <div className="glass" style={{ padding: '14px 18px', marginBottom: 16, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
        {sources.mode === 'auto'
          ? <>当前为 <b>智能自动</b>：解析按下方链路顺序竞速，失败自动切换下一源（音质自动降级 320k → 128k）。</>
          : <>当前为 <b>手动锁定</b>：播放时点击 Dock 右侧图钉指定音源，解析只走该源；失败会询问是否切回自动。</>}
      </div>

      {/* 解析链路可视化 */}
      <div className="glass chain-visual" style={{ marginBottom: 16 }}>
        <Radio size={15} color="var(--accent)" />
        {providers.map((p, i) => (
          <span key={p.id} className="row" style={{ gap: 8 }}>
            {i > 0 && <span className="chain-arrow">→</span>}
            <span className="chain-node" title={p.id}>
              {p.name}
              {p.kind === 'lx-script' && <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{statusOf(p) === 'ok' ? '●' : '○'}</span>}
            </span>
          </span>
        ))}
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 11 }}>拖动下方 ▲▼ 调整优先级</span>
      </div>

      {/* 添加音源面板 */}
      <AnimatePresence>
        {showAdd && <AddSourcePanel onDone={() => setShowAdd(false)} />}
      </AnimatePresence>

      {/* 音源卡片列表 */}
      <div className="song-list">
        {providers.map(p => {
          const isLx = p.id.startsWith('lx:')
          const isMf = p.id.startsWith('mf:')
          const entryId = isLx || isMf ? p.id.slice(3) : null
          const entry = isLx && entryId ? lxEntries.find(e => e.id === entryId) : null
          const mfEntry = isMf && entryId ? mfEntries.find(e => e.id === entryId) : null
          const isUpgrading = entryId ? upgrading.has(entryId) : false
          const st = statusOf(p)
          return (
            <motion.div key={p.id} className="src-card" layout>
              <div className="src-avatar" style={{ background: KIND_COLOR[p.kind] ?? KIND_COLOR.custom }}>
                {p.name.slice(0, 1)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="status-dot" style={{ marginLeft: -6 }} />
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</span>
                  <span className="src-badge">{KIND_LABEL[p.kind] ?? p.kind}</span>
                  {(entry?.repo || mfEntry?.repo) && (
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      <Link2 size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                      {entry?.repo ?? mfEntry?.repo}
                    </span>
                  )}
                  {(entry?.remoteDate || mfEntry?.remoteDate) && (
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      仓库更新：{(entry?.remoteDate ?? mfEntry?.remoteDate)!.slice(0, 10)}
                    </span>
                  )}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 7, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-3)' }}>
                  <span>平台：{p.caps.platforms.join(' · ') || '—'}</span>
                  <span>音质：{p.caps.qualities.join('/') || '—'}</span>
                  <span>延迟：{p.health.latencyMs ? p.health.latencyMs + 'ms' : '—'}</span>
                  <span>成功率：{okRate(p)}</span>
                  {(entry?.localVersion || mfEntry?.version) && <span>v{entry?.localVersion ?? mfEntry?.version}</span>}
                  {p.health.lastError && <span style={{ color: 'var(--danger)' }}>最近错误：{p.health.lastError.slice(0, 40)}</span>}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {entryId && (
                  <>
                    <button className="mini-btn" disabled={isUpgrading} onClick={() => void doUpgrade(p.id)} title="从 GitHub 仓库拉取最新脚本">
                      <Zap size={12} /> {isUpgrading ? '升级中…' : '升级'}
                    </button>
                    {isLx && (
                      <button className="mini-btn" onClick={() => void window.glass.rollbackSource(entryId)} title="回滚到备份脚本">
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </>
                )}
                <button className="mini-btn" onClick={() => void doTest(p.id)}>
                  <TestTube size={12} /> 测试
                </button>
                {p.id !== 'gd' && (
                  <button className={'switch' + (st === 'disabled' ? '' : ' on')} title={st === 'disabled' ? '启用' : '禁用'}
                    onClick={async () => {
                      const enable = st === 'disabled'
                      if (p.kind === 'lx-script') useStore.setState({ sources: await window.glass.setLxEnabled(entryId!, enable) })
                      else if (p.kind === 'musicfree-plugin') useStore.setState({ sources: await window.glass.setMfEnabled(p.id.slice(3), enable) })
                      else if (p.kind === 'http-api') useStore.setState({ sources: await window.glass.setHttpEnabled(p.id, enable) })
                    }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 4 }}>
                  <button className="icon-btn" style={{ width: 24, height: 20 }} onClick={() => void move(p.id, -1)}><ArrowUp size={13} /></button>
                  <button className="icon-btn" style={{ width: 24, height: 20 }} onClick={() => void move(p.id, 1)}><ArrowDown size={13} /></button>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      <div className="view-sub" style={{ marginTop: 16 }}>
        内置源：Huibq/keep-alive + pdone/lx-music-source（ikun/qdy/sixyin）· 升级前自动备份旧脚本，可回滚
      </div>
    </div>
  )
}

function AddSourcePanel({ onDone }: { onDone: () => void }): JSX.Element {
  const [tab, setTab] = useState<'script' | 'http'>('script')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [tpl, setTpl] = useState('https://lxmusicapi.onrender.com/url/{source}/{songId}/{quality}')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const showToast = useStore(s => s.showToast)

  const addScript = async () => {
    if (!url.trim()) { showToast('请填写脚本 URL'); return }
    setBusy(true)
    try {
      const r = await window.glass.addScriptSource(name.trim(), url.trim())
      showToast(r.ok ? '已添加：' + r.detail : '添加失败：' + r.detail)
      if (r.ok) { useStore.setState({ sources: await window.glass.sources() }); onDone() }
    } finally { setBusy(false) }
  }

  const addHttp = async () => {
    if (!tpl.trim()) { showToast('请填写 URL 模板'); return }
    setBusy(true)
    try {
      const r = await window.glass.addHttpSource({
        id: 'http-' + Date.now().toString(36),
        name: name.trim() || '自定义 HTTP 音源',
        urlTemplate: tpl.trim(),
        headers: key.trim() ? { 'X-Request-Key': key.trim() } : undefined,
        platforms: ['kw', 'kg', 'tx', 'wy', 'mg'],
        enabled: true
      })
      showToast(r.ok ? '已添加：' + r.detail : '添加失败：' + r.detail)
      if (r.ok) { useStore.setState({ sources: await window.glass.sources() }); onDone() }
    } finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div className="glass" style={{ padding: 18 }}>
        <div className="segmented" style={{ marginBottom: 14 }}>
          <button className={'seg-btn' + (tab === 'script' ? ' on' : '')} onClick={() => setTab('script')}>lx 源脚本 URL</button>
          <button className={'seg-btn' + (tab === 'http' ? ' on' : '')} onClick={() => setTab('http')}>通用 HTTP 模板</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input className="path-input" placeholder="音源名称（可选）" value={name} onChange={e => setName(e.target.value)} style={{ maxWidth: 200 }} />
          {tab === 'script' ? (
            <>
              <input className="path-input" placeholder="脚本 raw URL（raw.githubusercontent.com / jsdelivr）" value={url} onChange={e => setUrl(e.target.value)} style={{ maxWidth: 480 }} />
              <button className="mini-btn primary" disabled={busy} onClick={() => void addScript()}>加载并添加</button>
            </>
          ) : (
            <>
              <input className="path-input" placeholder="URL 模板 {source}/{songId}/{quality}" value={tpl} onChange={e => setTpl(e.target.value)} style={{ maxWidth: 420 }} />
              <input className="path-input" placeholder="鉴权头 X-Request-Key（可选）" value={key} onChange={e => setKey(e.target.value)} style={{ maxWidth: 220 }} />
              <button className="mini-btn primary" disabled={busy} onClick={() => void addHttp()}>添加模板</button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
