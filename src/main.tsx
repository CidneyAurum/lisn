import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { OverlayApp } from './OverlayApp'
import './styles/glass.css'

// 桌面歌词悬浮窗模式:主进程以 hash=overlay 加载同一渲染包
const isOverlay = window.location.hash.includes('overlay')
if (isOverlay) document.documentElement.classList.add('overlay-mode')

/** 全局错误边界:渲染异常显示可恢复的错误界面,而非白/黑屏 */
class RootBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 40, color: '#fffeef' }}>
          <h2 style={{ marginBottom: 12 }}>界面出错了</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'rgba(255,254,239,.6)', marginBottom: 20 }}>{String(this.state.err?.stack || this.state.err)}</pre>
          <button onClick={() => location.reload()} style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid #39c5bb', background: '#39c5bb', color: '#04211f', cursor: 'pointer' }}>重新加载</button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  isOverlay
    ? <OverlayApp />
    : <React.StrictMode>
        <RootBoundary>
          <App />
        </RootBoundary>
      </React.StrictMode>
)
