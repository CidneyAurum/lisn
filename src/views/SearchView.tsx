import { useEffect, useState } from 'react'
import { Search, Sparkles, ChevronDown, Loader2, Save } from 'lucide-react'
import { useStore } from '../stores/store'
import { SongTable, SearchSkeleton } from '../components/SongTable'

const HOT = ['周杰伦', '晴天', '林俊杰', '邓紫棋', '海阔天空', '陈奕迅', '夜曲', '赵雷']

export function SearchView(): JSX.Element {
  const keyword = useStore(s => s.keyword)
  const setKeyword = useStore(s => s.setKeyword)
  const results = useStore(s => s.results)
  const searching = useStore(s => s.searching)
  const searched = useStore(s => s.searched)
  const doSearch = useStore(s => s.doSearch)
  const loadMore = useStore(s => s.loadMore)
  const hasMore = useStore(s => s.hasMore)
  const loadingMore = useStore(s => s.loadingMore)
  const showToast = useStore(s => s.showToast)
  const [localKw, setLocalKw] = useState(keyword)

  useEffect(() => { setLocalKw(keyword) }, [keyword])

  return (
    <div>
      {!searched && !searching ? (
        <div className="search-hero">
          <h1>发现音乐</h1>
          <p>聚合 GD音乐台 + GitHub 开源音源 · 支持 VIP 曲目在线试听与下载</p>
          <div className="search-capsule">
            <Search size={18} color="var(--text-3)" />
            <input
              placeholder="搜索歌曲、歌手、专辑…"
              value={localKw}
              autoFocus
              onChange={e => setLocalKw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void doSearch(localKw) }}
            />
            <button className="search-go" onClick={() => void doSearch(localKw)}>
              <Sparkles size={14} />
              搜索
            </button>
          </div>
          <div className="hot-chips">
            {HOT.map(h => (
              <button key={h} className="chip" onClick={() => { setLocalKw(h); void doSearch(h) }}>{h}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="search-capsule" style={{ height: 48, marginTop: 4, marginBottom: 20 }}>
            <Search size={17} color="var(--text-3)" />
            <input
              value={localKw}
              onChange={e => setLocalKw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void doSearch(localKw) }}
            />
            <button className="search-go" onClick={() => void doSearch(localKw)}>搜索</button>
          </div>
          {searching ? (
            <>
              <div className="view-sub" style={{ marginBottom: 12 }}>正在聚合搜索「{keyword}」…</div>
              <SearchSkeleton />
            </>
          ) : results.length ? (
            <>
              <div className="view-sub" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>「{keyword}」已聚合 {results.length} 条（双击行播放，支持 VIP 曲目）</span>
                {results.length > 0 && (
                  <button className="mini-btn" onClick={async () => {
                    const name = window.prompt('歌单名称：', keyword + ' 精选')
                    if (!name) return
                    await window.glass.plSaveFromSearch(name, keyword, results.slice(0, 30))
                    showToast('已保存「' + name + '」（前 30 首）')
                  }}>
                    <Save size={12} /> 存为歌单
                  </button>
                )}
              </div>
              <SongTable songs={results} />
              {hasMore && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '22px 0 8px' }}>
                  <button className="mini-btn" disabled={loadingMore} onClick={() => void loadMore()} style={{ padding: '10px 28px' }}>
                    {loadingMore ? <><Loader2 size={13} className="spin" /> 加载中…</> : <><ChevronDown size={13} /> 加载更多</>}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="icon"><Search size={42} strokeWidth={1.2} /></div>
              没有找到「{keyword}」的相关结果
            </div>
          )}
        </div>
      )}
    </div>
  )
}
