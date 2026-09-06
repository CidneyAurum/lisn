import { FolderOpen, RotateCcw, X, Trash2, Download } from 'lucide-react'
import { useStore } from '../stores/store'
import { SourceBadge } from '../components/SourceBadge'

function fmtSize(b: number): string {
  if (!b) return '—'
  const mb = b / 1024 / 1024
  return mb >= 1 ? mb.toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB'
}

const STATUS_TEXT: Record<string, string> = {
  waiting: '排队中', resolving: '解析音源…', downloading: '下载中',
  completed: '已完成', failed: '失败', cancelled: '已取消'
}

export function DownloadsView(): JSX.Element {
  const downloads = useStore(s => s.downloads)
  const showToast = useStore(s => s.showToast)
  const refresh = useStore(s => s.refreshDownloads)

  if (!downloads.length) {
    return (
      <div className="empty-state">
        <div className="icon"><Download size={42} strokeWidth={1.2} /></div>
        下载队列为空 · 在搜索页点击下载按钮即可加入
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <div className="view-title" style={{ margin: 0 }}>下载管理</div>
        </div>
        <div className="spacer" />
        <button className="mini-btn" onClick={async () => { await window.glass.clearDl(); void refresh() }}>
          <Trash2 size={13} /> 清除已完成
        </button>
      </div>
      <div className="song-list">
        {downloads.map(item => (
          <div key={item.id} className="dl-row">
            <div style={{ textAlign: 'center' }}>
              <SourceBadge platform={item.platform} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="song-name">{item.name}</div>
              <div className="song-artist" style={{ marginTop: 2 }}>
                {item.artist} · {item.quality.toUpperCase()}
                {item.error ? <span style={{ color: 'var(--danger)' }}> · {item.error.slice(0, 60)}</span> : ''}
              </div>
            </div>
            <div>
              <div className="dl-bar">
                <div className={'fill' + (item.status === 'downloading' ? ' flowing' : '')} style={{ width: Math.round(item.progress * 100) + '%' }} />
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4 }}>
                {fmtSize(item.received)}{item.total ? ' / ' + fmtSize(item.total) : ''}
              </div>
            </div>
            <div className={'dl-status ' + item.status}>
              {STATUS_TEXT[item.status] ?? item.status}
              {item.status === 'downloading' ? ' ' + Math.round(item.progress * 100) + '%' : ''}
            </div>
            <div className="row" style={{ gap: 4 }}>
              {item.filePath && item.status === 'completed' && (
                <button className="icon-btn" title="打开所在位置" onClick={() => void window.glass.openPath(item.filePath!)}>
                  <FolderOpen size={15} />
                </button>
              )}
              {(item.status === 'failed' || item.status === 'cancelled') && (
                <button className="icon-btn" title="重试" onClick={() => void window.glass.retryDl(item.id)}>
                  <RotateCcw size={15} />
                </button>
              )}
              {item.status !== 'downloading' && (
                <button className="icon-btn" title="移除" onClick={() => void window.glass.removeDl(item.id)}>
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="view-sub" style={{ marginTop: 14 }}>
        队列自动节流（单并发 + 间隔保护，防止免费音源封 IP）
      </div>
    </div>
  )
}
