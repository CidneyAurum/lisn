import { useEffect, useState } from 'react'
import { Search, CalendarDays, Shuffle, Compass, Play, Loader2, ChevronRight, Plus, ListMusic } from 'lucide-react'
import { useStore } from '../stores/store'

const HOT_CHIPS = ['晴天', '海阔天空', '突然好想你', '漠河舞厅', '孤勇者', '起风了']

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 日期稳定哈希 → 每天固定选 2 个关键词 */
const DAILY_POOL = ['周杰伦', '林俊杰', '陈奕迅', '邓紫棋', '薛之谦', '五月天', '告五人', '房东的猫', '毛不易', '新裤子', '回春丹', '泽野弘之', 'YOASOBI', 'Aimer', 'RADWIMPS', '米津玄师']
function dailyKeywords(): string[] {
  const d = new Date()
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  const a = DAILY_POOL[seed % DAILY_POOL.length]
  const b = DAILY_POOL[(seed * 7 + 3) % DAILY_POOL.length]
  return [...new Set([a, b])]
}

const GRADS = [
  'linear-gradient(135deg,#5e5ce6,#64d2ff)',
  'linear-gradient(135deg,#ff7a95,#64d2ff)',
  'linear-gradient(135deg,#32d074,#5e5ce6)',
  'linear-gradient(135deg,#ffb340,#ff2d55)',
  'linear-gradient(135deg,#39c5bb,#5e5ce6)',
  'linear-gradient(135deg,#7d7bff,#ff2d55)'
]

export function DiscoverView(): JSX.Element {
  const setView = useStore(s => s.setView)
  const doSearch = useStore(s => s.doSearch)
  const playlists = useStore(s => s.playlists)
  const searching = useStore(s => s.searching)
  const [kw, setKw] = useState('')
  const [dailyLoading, setDailyLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const today = new Date()
  const g = greeting()

  useEffect(() => { void useStore.getState().refreshPlaylists() }, [])

  const openDaily = async () => {
    setDailyLoading(true)
    try {
      const kws = dailyKeywords()
      const merged: any[] = []
      const seen = new Set<string>()
      for (const k of kws) {
        const r = await window.glass.search(k, 1)
        for (const s of r.songs) {
          if (!seen.has(s.key)) { seen.add(s.key); merged.push(s) }
        }
        if (merged.length >= 45) break
      }
      const dateStr = (today.getMonth() + 1) + '月' + today.getDate() + '日'
      setView('playlist')
      useStore.setState({
        playlist: { kind: 'agg', title: '每日推荐 · ' + dateStr, sub: '根据今天日期为你轮换的 ' + kws.join(' / ') + ' 精选', keyword: kws.join(' '), songs: merged.slice(0, 50) }
      })
    } finally { setDailyLoading(false) }
  }

  const startRoaming = async () => {
    const pool = playlists.length ? HOT_CHIPS : HOT_CHIPS
    const kw = pool[Math.floor(Math.random() * pool.length)]
    const r = await window.glass.search(kw, 1)
    if (!r.songs.length) { useStore.getState().showToast('漫游暂时没有结果，再试一次'); return }
    const song = r.songs[Math.floor(Math.random() * Math.min(r.songs.length, 20))]
    useStore.setState({ keyword: kw, results: r.songs, searched: true })
    setView('search')
    useStore.getState().showToast('私人漫游：' + song.name + ' · ' + song.artist)
    await useStore.getState().play(song, r.songs)
  }

  const createPlaylist = async () => {
    if (!newName.trim()) { setCreating(false); return }
    await window.glass.plCreate(newName.trim())
    setNewName('')
    setCreating(false)
    useStore.getState().showToast('歌单已创建，去搜索页把歌加进来')
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      {/* 问候 + 搜索 */}
      <div className="discover-hero">
        <div>
          <div className="discover-greeting">{g}</div>
          <div className="discover-sub">
            {today.getFullYear()}年{today.getMonth() + 1}月{today.getDate()}日 · 所有好听的音乐，都在这里
          </div>
        </div>
        <div className="discover-search">
          <Search size={16} color="var(--text-3)" />
          <input
            placeholder="搜索歌曲 / 歌手 / 专辑"
            value={kw}
            onChange={e => setKw(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && kw.trim()) {
                useStore.setState({ keyword: kw.trim(), searched: true, results: [] })
                void doSearch(kw.trim())
                setView('search')
              }
            }}
          />
          <button className="icon-btn" onClick={() => { if (kw.trim()) { useStore.setState({ keyword: kw.trim(), searched: true, results: [] }); void doSearch(kw.trim()); setView('search') } }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* 三卡 */}
      <div className="hero-cards">
        <div className="hero-card daily" onClick={() => void openDaily()} style={{ cursor: 'pointer' }}>
          <CalendarDays size={22} className="hc-icon" />
          <div className="hc-date">{String(today.getMonth() + 1).padStart(2, '0')}{String(today.getDate()).padStart(2, '0')}</div>
          <div className="hc-title">{dailyLoading ? '生成中…' : '每日推荐'}</div>
          <div className="hc-sub">每天为你轮换两位歌手的精选歌单</div>
        </div>
        <div className="hero-card roam" onClick={() => void startRoaming()}>
          <Shuffle size={20} className="hc-icon" />
          <div className="hc-title">私人漫游</div>
          <div className="hc-sub">随机挑一首，马上播放</div>
        </div>
        <div className="hero-card roam" onClick={() => setView('sources')}>
          <Compass size={20} className="hc-icon" />
          <div className="hc-title">音源中心</div>
          <div className="hc-sub">查看音源状态 · 更新与升级</div>
        </div>
      </div>

      {/* 我的歌单（自建） */}
      <div className="section-head">
        <h3>我的歌单</h3>
        <span className="more">搜索结果里的 ⊕ 按钮可以把歌加进来</span>
      </div>
      <div className="pl-grid">
        {/* 新建歌单卡 */}
        <div className="pl-card" onClick={() => setCreating(true)}>
          <div className="pl-cover" style={{ border: '1px dashed rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.03)' }}>
            {creating ? (
              <div style={{ padding: 12, width: '100%' }} onClick={e => e.stopPropagation()}>
                <input
                  className="path-input"
                  placeholder="歌单名称"
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void createPlaylist(); if (e.key === 'Escape') setCreating(false) }}
                  style={{ width: '100%', height: 34, marginBottom: 8 }}
                />
                <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
                  <button className="mini-btn primary" onClick={() => void createPlaylist()}>创建</button>
                  <button className="mini-btn" onClick={() => setCreating(false)}>取消</button>
                </div>
              </div>
            ) : (
              <Plus size={30} color="var(--text-3)" />
            )}
          </div>
          <div className="pl-name">新建歌单</div>
          <div className="pl-count">自建 · 永久保存</div>
        </div>

        {/* 已建歌单卡 */}
        {playlists.map((p, i) => (
          <div key={p.id} className="pl-card" onClick={() => {
            setView('playlist')
            useStore.setState({ playlist: { kind: 'custom', id: p.id } })
          }}>
            <div className="pl-cover">
              {p.songs[0]?.picUrl
                ? <img src={p.songs[0].picUrl} alt="" />
                : <div style={{ width: '100%', height: '100%', background: GRADS[i % GRADS.length], display: 'grid', placeItems: 'center' }}>
                    <ListMusic size={26} color="rgba(255,255,255,0.9)" />
                  </div>}
              <div className="pl-grad" />
              <div className="pl-play"><Play size={16} fill="currentColor" /></div>
            </div>
            <div className="pl-name">{p.name}</div>
            <div className="pl-count">{p.songs.length} 首 · 自建</div>
          </div>
        ))}
      </div>

      {!playlists.length && (
        <div className="view-sub" style={{ marginBottom: 30, lineHeight: 1.8 }}>
          还没有自建歌单：在搜索结果里点每行的 <span className="src-badge">⊕</span> 加入歌单，或在搜索页一键「存为歌单」
        </div>
      )}

      {/* 热门搜索 */}
      <div className="section-head">
        <h3>热门搜索</h3>
        <span className="more">大家在听</span>
      </div>
      <div className="hot-chips" style={{ justifyContent: 'flex-start', marginBottom: 30 }}>
        {HOT_CHIPS.map(h => (
          <button key={h} className="chip" onClick={() => { useStore.setState({ keyword: h, searched: true, results: [] }); void doSearch(h); setView('search') }}>{h}</button>
        ))}
      </div>

      {searching && <div className="row" style={{ color: 'var(--text-3)', padding: '10px 0', fontSize: 13 }}><Loader2 size={15} className="spin" /> 搜索中…</div>}
    </div>
  )
}
