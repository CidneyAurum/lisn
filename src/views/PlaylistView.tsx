import { Play, Loader2, ChevronLeft, Download, Trash2, X, Pencil } from 'lucide-react'
import { useStore } from '../stores/store'
import { SongTable } from '../components/SongTable'

export function PlaylistView(): JSX.Element {
  const playlist = useStore(s => s.playlist)
  const playlists = useStore(s => s.playlists)
  const setView = useStore(s => s.setView)
  const play = useStore(s => s.play)
  const quality = useStore(s => s.quality)
  const showToast = useStore(s => s.showToast)
  const refreshPlaylists = useStore(s => s.refreshPlaylists)

  if (!playlist) return <div className="empty-state">歌单不存在</div>

  // ===== 自建歌单 =====
  if (playlist.kind === 'custom') {
    const pl = playlists.find(p => p.id === playlist.id)
    if (!pl) return <div className="empty-state">歌单不存在或已删除</div>

    const playAll = () => { if (pl.songs.length) void play(pl.songs[0], pl.songs) }

    const downloadAll = async () => {
      for (const s of pl.songs.slice(0, 5)) await window.glass.enqueue(s, quality)
      showToast('已把前 5 首加入下载队列（节流保护）')
    }

    const renamePl = async () => {
      const name = window.prompt('重命名歌单：', pl.name)
      if (!name || name === pl.name) return
      await window.glass.plRename(pl.id, name)
      await refreshPlaylists()
      showToast('已重命名为「' + name + '」')
    }

    const deletePl = async () => {
      if (!window.confirm('删除歌单「' + pl.name + '」？歌曲文件不受影响')) return
      await window.glass.plDelete(pl.id)
      await refreshPlaylists()
      setView('discover')
    }

    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button className="mini-btn" style={{ marginBottom: 16 }} onClick={() => setView('discover')}>
          <ChevronLeft size={13} /> 返回发现页
        </button>

        <div className="row" style={{ gap: 22, marginBottom: 24, alignItems: 'flex-end' }}>
          <div style={{
            width: 148, height: 148, borderRadius: 'var(--r-lg)',
            background: pl.songs[0]?.picUrl ? undefined : 'linear-gradient(135deg,#5e5ce6,#64d2ff)',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 14px 40px rgba(94,92,230,.4), inset 0 1px 0 rgba(255,255,255,.2)',
            flexShrink: 0, overflow: 'hidden'
          }}>
            {pl.songs[0]?.picUrl
              ? <img src={pl.songs[0].picUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Play size={44} color="rgba(255,255,255,.92)" fill="rgba(255,255,255,.92)" />}
          </div>
          <div style={{ minWidth: 0, paddingBottom: 4 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '.3px' }}>{pl.name}</div>
            <div className="view-sub" style={{ marginTop: 8 }}>自建歌单 · 共 {pl.songs.length} 首{pl.keyword ? ' · 来源：' + pl.keyword : ''}</div>
            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <button className="mini-btn primary" onClick={playAll} disabled={!pl.songs.length}>
                <Play size={13} fill="currentColor" /> 播放全部
              </button>
              <button className="mini-btn" onClick={() => void downloadAll()} disabled={!pl.songs.length}>
                <Download size={13} /> 下载前 5 首
              </button>
              <button className="mini-btn" onClick={() => void renamePl()}>
                <Pencil size={13} /> 重命名
              </button>
              <button className="mini-btn" style={{ color: 'var(--danger)' }} onClick={() => void deletePl()}>
                <Trash2 size={13} /> 删除歌单
              </button>
            </div>
          </div>
        </div>

        {pl.songs.length ? (
          <div className="song-list">
            {pl.songs.map((song, i) => (
              <div key={song.key} className="song-row" onDoubleClick={() => void play(song, pl.songs)}>
                <div className="song-idx">{String(i + 1).padStart(2, '0')}</div>
                <div className="song-cover">
                  {song.picUrl ? <img src={song.picUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Play size={14} />}
                </div>
                <div>
                  <div className="song-name">{song.name}</div>
                  <div className="song-artist" style={{ marginTop: 2 }}>{song.artist}</div>
                </div>
                <div className="song-album">{song.album || '—'}</div>
                <div />
                <div className="song-actions">
                  <button className="icon-btn accent" title="播放" onClick={() => void play(song, pl.songs)}>
                    <Play size={15} fill="currentColor" />
                  </button>
                  <button className="icon-btn" title="从歌单移除" onClick={async () => {
                    await window.glass.plRemoveSong(pl.id, song.key)
                    await refreshPlaylists()
                    showToast('已从歌单移除')
                  }}>
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">歌单还是空的 · 去搜索页点歌曲行的 ⊕ 添加</div>
        )}
      </div>
    )
  }

  // ===== 聚合歌单（每日推荐）=====
  const playAll = () => { if (playlist.songs.length) void play(playlist.songs[0], playlist.songs) }
  const downloadAll = async () => {
    for (const s of playlist.songs.slice(0, 5)) await window.glass.enqueue(s, quality)
    showToast('已把前 5 首加入下载队列（节流保护，稍候完成）')
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <button className="mini-btn" style={{ marginBottom: 16 }} onClick={() => setView('discover')}>
        <ChevronLeft size={13} /> 返回发现页
      </button>

      <div className="row" style={{ gap: 22, marginBottom: 24, alignItems: 'flex-end' }}>
        <div style={{
          width: 148, height: 148, borderRadius: 'var(--r-lg)',
          background: 'linear-gradient(135deg,#5e5ce6,#64d2ff)',
          display: 'grid', placeItems: 'center',
          boxShadow: '0 14px 40px rgba(94,92,230,.4), inset 0 1px 0 rgba(255,255,255,.2)',
          flexShrink: 0
        }}>
          <Play size={44} color="rgba(255,255,255,.92)" fill="rgba(255,255,255,.92)" />
        </div>
        <div style={{ minWidth: 0, paddingBottom: 4 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '.3px' }}>{playlist.title}</div>
          <div className="view-sub" style={{ marginTop: 8 }}>{playlist.sub}</div>
          <div className="view-sub">共 {playlist.songs.length} 首 · 双击行播放</div>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="mini-btn primary" onClick={playAll} disabled={!playlist.songs.length}>
              <Play size={13} fill="currentColor" /> 播放全部
            </button>
            <button className="mini-btn" onClick={() => void downloadAll()} disabled={!playlist.songs.length}>
              <Download size={13} /> 下载前 5 首
            </button>
          </div>
        </div>
      </div>

      {playlist.songs.length
        ? <SongTable songs={playlist.songs} />
        : <div className="row" style={{ color: 'var(--text-3)', padding: '30px 0', fontSize: 13 }}>
            <Loader2 size={15} className="spin" /> 正在聚合音源…
          </div>}
    </div>
  )
}
