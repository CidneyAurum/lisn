import { useEffect } from 'react'
import { Play, FolderOpen, Library, RefreshCw } from 'lucide-react'
import { useStore } from '../stores/store'
import { getAudio } from '../stores/store'

function fmtSize(b: number): string {
  const mb = b / 1024 / 1024
  return mb >= 1 ? mb.toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB'
}

export function LibraryView(): JSX.Element {
  const library = useStore(s => s.library)
  const refreshLibrary = useStore(s => s.refreshLibrary)
  const settings = useStore(s => s.settings)

  useEffect(() => { void refreshLibrary() }, [refreshLibrary])

  const playLocal = async (filePath: string) => {
    const url = await window.glass.localStreamUrl(filePath)
    const audio = getAudio()
    audio.src = url
    void audio.play()
  }

  if (!library?.files.length) {
    return (
      <div className="empty-state">
        <div className="icon"><Library size={42} strokeWidth={1.2} /></div>
        本地曲库为空 · 下载完成后自动出现在这里
        <div style={{ marginTop: 14 }}>
          <button className="mini-btn" onClick={() => void refreshLibrary()}><RefreshCw size={13} /> 刷新</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="view-title" style={{ margin: 0 }}>本地曲库</div>
        <div className="view-sub" style={{ margin: 0 }}>{library.files.length} 首 · {library.dir}</div>
        <div className="spacer" />
        <button className="mini-btn" onClick={() => void window.glass.openPath(library.dir)}>
          <FolderOpen size={13} /> 打开目录
        </button>
        <button className="mini-btn" onClick={() => void refreshLibrary()}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>
      <div className="song-list">
        {library.files.map(f => (
          <div key={f.filePath} className="song-row" onDoubleClick={() => void playLocal(f.filePath)}>
            <div className="song-idx" />
            <div className="song-cover" style={{ borderRadius: 10 }}>
              <Play size={14} onClick={() => void playLocal(f.filePath)} style={{ cursor: 'pointer' }} />
            </div>
            <div>
              <div className="song-name">{f.name}</div>
              <div className="song-artist" style={{ marginTop: 2 }}>{f.artist}</div>
            </div>
            <div className="song-album">{fmtSize(f.size)}</div>
            <div className="row">
              <span className="src-badge">{f.isFlac ? 'FLAC' : 'MP3'}</span>
            </div>
            <div className="song-actions">
              <button className="icon-btn" title="打开所在位置" onClick={() => void window.glass.openPath(f.filePath)}>
                <FolderOpen size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {settings && (
        <div className="view-sub" style={{ marginTop: 14 }}>目录可在「设置」中修改（当前：{settings.downloadDir}）</div>
      )}
    </div>
  )
}
