import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { OverlayApp } from './OverlayApp'
import './styles/glass.css'

// 桌面歌词悬浮窗模式:主进程以 hash=overlay 加载同一渲染包
const isOverlay = window.location.hash.includes('overlay')
if (isOverlay) document.documentElement.classList.add('overlay-mode')

createRoot(document.getElementById('root')!).render(
  isOverlay
    ? <OverlayApp />
    : <React.StrictMode>
        <App />
      </React.StrictMode>
)
