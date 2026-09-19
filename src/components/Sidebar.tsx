import { Search, Download, Library, Radio, Settings2, Music4, Compass, Moon, ListMusic, Plus } from 'lucide-react'
import { useStore } from '../stores/store'
import type { View } from '../stores/store'

const MAIN_NAV: { id: View; label: string; icon: typeof Search }[] = [
  { id: 'discover', label: '发现', icon: Compass },
  { id: 'search', label: '搜索', icon: Search }
]

const MY_MUSIC: { id: View; label: string; icon: typeof Search }[] = [
  { id: 'downloads', label: '下载管理', icon: Download },
  { id: 'library', label: '本地曲库', icon: Library }
]

const SYSTEM: { id: View; label: string; icon: typeof Search }[] = [
  { id: 'sources', label: '音源中心', icon: Radio },
  { id: 'settings', label: '设置', icon: Settings2 }
]

export function Sidebar(): JSX.Element {
  const view = useStore(s => s.view)
  const setView = useStore(s => s.setView)
  const downloads = useStore(s => s.downloads)
  const sources = useStore(s => s.sources)
  const activeDl = downloads.filter(d => ['downloading', 'waiting', 'resolving'].includes(d.status)).length
  const okSources = sources?.providers.filter(p => p.health.status === 'ok').length ?? 0

  const playlists = useStore(s => s.playlists)

  const renderItem = ({ id, label, icon: Icon }: { id: View; label: string; icon: typeof Search }) => (
    <button key={id} className={'nav-item' + (view === id ? ' active' : '')} onClick={() => setView(id)}>
      <Icon size={17} strokeWidth={1.8} />
      {label}
      {id === 'downloads' && activeDl > 0 && <span className="nav-badge">{activeDl}</span>}
    </button>
  )

  return (
    <aside className="sidebar glass-sidebar">
      <div className="brand">
        <div className="brand-icon" style={{ borderRadius: 12, background: 'linear-gradient(135deg,#39c5bb 0%,#e12885 100%)' }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: '#fff', fontFamily: 'serif' }}>聆</span>
        </div>
        <div>
          <div className="brand-name">聆 <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)' }}>LISN</span></div>
          <div className="brand-sub">你的音乐，由此展开</div>
        </div>
      </div>

      <div className="nav-section">
        {MAIN_NAV.map(renderItem)}
      </div>

      <div className="nav-section">
        <div className="nav-section-title">我的音乐</div>
        {MY_MUSIC.map(renderItem)}
      </div>

      <div className="nav-section">
        <div className="nav-section-title">创建的歌单</div>
        <button className="playlist-item" onClick={() => { setView('discover'); setTimeout(() => { document.querySelector('.pl-cover')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }, 60) }}>
          <Plus size={15} className="pl-ico" /> 新建歌单
        </button>
        {playlists.slice(0, 8).map(p => (
          <button key={p.id} className={'playlist-item' + (view === 'playlist' ? ' active' : '')} onClick={() => {
            setView('playlist')
            useStore.setState({ playlist: { kind: 'custom', id: p.id } })
          }}>
            <ListMusic size={15} className="pl-ico" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-3)' }}>{p.songs.length}</span>
          </button>
        ))}
        {!playlists.length && <div style={{ padding: '2px 12px 6px', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>在搜索结果点 ⊕ 添加</div>}
      </div>

      <div className="nav-section">
        <div className="nav-section-title">系统</div>
        {SYSTEM.map(renderItem)}
      </div>

      <div className="sidebar-footer">
        <Moon size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
        音源 {okSources > 0 ? <span style={{ color: 'var(--ok)' }}>{okSources} 源在线</span> : '加载中…'}
        <br />GitHub 免费生态 · 学习试听
      </div>
    </aside>
  )
}
