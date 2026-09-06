import { Play, Download, Music4, Plus, Check } from 'lucide-react'
import { useState } from 'react'
import type { Song } from '../types'
import { useStore } from '../stores/store'
import { motion, AnimatePresence } from 'framer-motion'

/** 加入歌单弹层：列出全部自建歌单 + 新建 */
export function AddToPlaylistDialog({ song, onClose }: { song: Song; onClose: () => void }): JSX.Element {
  const playlists = useStore(s => s.playlists)
  const showToast = useStore(s => s.showToast)
  const refresh = useStore(s => s.refreshPlaylists)
  const [newName, setNewName] = useState('')
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const add = async (id: string, name: string) => {
    const r = await window.glass.plAddSong(id, song)
    showToast(r.detail)
    if (r.ok) setAdded(new Set(added).add(id))
  }

  const createAndAdd = async () => {
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      const pl = await window.glass.plCreate(newName.trim())
      await refresh()
      const r = await window.glass.plAddSong(pl.id, song)
      showToast(r.detail)
      if (r.ok) setAdded(new Set(added).add(pl.id))
      setNewName('')
    } finally { setBusy(false) }
  }

  return (
    <motion.div
      className="q-pop"
      style={{ position: 'fixed', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', width: 340, zIndex: 200 }}
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="q-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>把「{song.name.slice(0, 14)}{song.name.length > 14 ? '…' : ''}」加入歌单</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={onClose}><Plus size={13} style={{ transform: 'rotate(45deg)' }} /></button>
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', padding: '0 4px 4px' }}>
        {playlists.map(p => (
          <button key={p.id} className={'q-opt' + (added.has(p.id) ? ' on' : '')} onClick={() => void add(p.id, p.name)}>
            <span>{p.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{added.has(p.id) ? <Check size={12} /> : p.songs.length + ' 首'}</span>
          </button>
        ))}
        {!playlists.length && <div className="muted" style={{ padding: '10px 12px', fontSize: 12 }}>还没有歌单，下面新建一个</div>}
      </div>
      <div className="row" style={{ padding: '8px 10px 6px', gap: 8 }}>
        <input
          className="path-input"
          placeholder="新歌单名称…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void createAndAdd() }}
          style={{ maxWidth: 200, height: 34 }}
        />
        <button className="mini-btn primary" disabled={busy} onClick={() => void createAndAdd()}>新建并加入</button>
      </div>
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
