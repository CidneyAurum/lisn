import { Play, Download, Music4, Plus, Check, X, ListMusic } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Song } from '../types'
import { useStore } from '../stores/store'
import { motion, AnimatePresence } from 'framer-motion'

/** 加入歌单对话框:居中模态 + 遮罩,列表带封面缩略图,支持新建并加入 */
export function AddToPlaylistDialog({ song, onClose }: { song: Song; onClose: () => void }): JSX.Element {
  const playlists = useStore(s => s.playlists)
  const showToast = useStore(s => s.showToast)
  const refresh = useStore(s => s.refreshPlaylists)
  const [newName, setNewName] = useState('')
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const add = async (id: string, name: string) => {
    const r = await window.glass.plAddSong(id, song)
    showToast(r.detail)
    if (r.ok) setAdded(prev => new Set(prev).add(id))
  }

  const createAndAdd = async () => {
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      const pl = await window.glass.plCreate(newName.trim())
      await refresh()
      const r = await window.glass.plAddSong(pl.id, song)
      showToast(r.detail)
      if (r.ok) setAdded(prev => new Set(prev).add(pl.id))
      setNewName('')
    } finally { setBusy(false) }
  }

  return (
    <motion.div className="dlg-mask" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <motion.div className="dlg" onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}>
        <div className="dlg-head">
          <div className="dlg-title">加入歌单</div>
          <div className="dlg-sub">「{song.name.length > 22 ? song.name.slice(0, 22) + '…' : song.name}」 · {song.artist}</div>
          <button className="dlg-close" onClick={onClose} title="关闭 (Esc)"><X size={16} /></button>
        </div>

        <div className="dlg-body">
          {playlists.length ? playlists.map(p => {
            const done = added.has(p.id)
            return (
              <button key={p.id} className={'dlg-item' + (done ? ' done' : '')} onClick={() => void add(p.id, p.name)}>
                <div className="dlg-item-cover">
                  {p.cover
                    ? <img src={p.cover} alt="" />
                    : (p.songs.filter(s => s.picUrl).length >= 4)
                      ? <div className="dlg-mosaic">{p.songs.filter(s => s.picUrl).slice(0, 4).map((s, k) => <img key={k} src={s.picUrl} alt="" />)}</div>
                      : p.songs[0]?.picUrl
                        ? <img src={p.songs[0].picUrl} alt="" />
                        : <div className="dlg-item-ph"><ListMusic size={16} /></div>}
                </div>
                <div className="dlg-item-main">
                  <div className="dlg-item-name">{p.name}</div>
                  <div className="dlg-item-meta">{p.songs.length} 首{p.keyword ? ' · ' + p.keyword : ''}</div>
                </div>
                <div className="dlg-item-act">{done ? <><Check size={15} /> 已加入</> : <><Plus size={15} /> 加入</>}</div>
              </button>
            )
          }) : (
            <div className="dlg-empty">还没有歌单,在下方新建一个</div>
          )}
        </div>

        <div className="dlg-foot">
          <input
            className="dlg-input"
            placeholder="新建歌单名称…"
            value={newName}
            autoFocus
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createAndAdd() }}
          />
          <button className="mini-btn primary" disabled={!newName.trim() || busy} onClick={() => void createAndAdd()}>
            {busy ? '创建中…' : '新建并加入'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function SongTable({ songs }: { songs: Song[] }): JSX.Element {
  const play = useStore(s => s.play)
  const results = useStore(s => s.results)
  const current = useStore(s => s.current)
  const playing = useStore(s => s.playing)
  const quality = useStore(s => s.quality)
  const showToast = useStore(s => s.showToast)
  const [plSong, setPlSong] = useState<Song | null>(null)

  const doDownload = async (song: Song) => {
    await window.glass.enqueue(song, quality)
    showToast('已加入下载队列：' + song.name)
  }

  return (
    <div className="song-list" onClick={() => setPlSong(null)}>
      {songs.map((song, i) => {
        const isCurrent = current?.key === song.key
        return (
          <div
            key={song.key}
            className={'song-row' + (isCurrent ? ' playing' : '')}
            onDoubleClick={() => void play(song, results)}
          >
            <div className="song-idx">
              {isCurrent && playing ? (
                <div className="eq"><span /><span /><span /></div>
              ) : (
                String(i + 1).padStart(2, '0')
              )}
            </div>
            <div className="song-cover">
              {song.picUrl ? <img src={song.picUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music4 size={16} />}
            </div>
            <div>
              <div className="song-name">{song.name}</div>
              <div className="song-artist" style={{ marginTop: 2 }}>{song.artist}</div>
            </div>
            <div className="song-album">{song.album || '—'}</div>
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
              {song.origins.slice(0, 4).map(o => (
                <span key={o.platform + o.songId} className={'src-badge plat-' + o.platform}>
                  {o.platform}
                </span>
              ))}
            </div>
            <div className="song-actions">
              <button className="icon-btn accent" title="播放" onClick={() => void play(song, results)}>
                <Play size={15} fill="currentColor" />
              </button>
              <button className="icon-btn accent" title="加入歌单" onClick={e => { e.stopPropagation(); setPlSong(song) }}>
                <Plus size={15} />
              </button>
              <button className="icon-btn accent" title={'下载 ' + quality.toUpperCase()} onClick={() => void doDownload(song)}>
                <Download size={15} />
              </button>
            </div>
          </div>
        )
      })}
      <AnimatePresence>
        {plSong && <AddToPlaylistDialog song={plSong} onClose={() => setPlSong(null)} />}
      </AnimatePresence>
    </div>
  )
}

export function SearchSkeleton({ n = 7 }: { n?: number }): JSX.Element {
  return (
    <div className="song-list">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="skeleton-row" />)}
    </div>
  )
}
