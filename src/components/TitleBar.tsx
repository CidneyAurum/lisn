import { Minus, Square, X, Disc3 } from 'lucide-react'

export function TitleBar(): JSX.Element {
  return (
    <div className="titlebar">
      <div className="title">
        <Disc3 size={15} strokeWidth={1.8} />
        聆 LISN
      </div>
      <div className="win-controls">
        <button className="win-btn" onClick={() => window.glass.minimize()} title="最小化">
          <Minus size={14} />
        </button>
        <button className="win-btn" onClick={() => window.glass.maximize()} title="最大化/还原">
          <Square size={11} />
        </button>
        <button className="win-btn close" onClick={() => window.glass.close()} title="关闭">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
