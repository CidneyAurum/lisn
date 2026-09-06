const PLATFORM_LABEL: Record<string, string> = {
  wy: '网易云', kw: '酷我', tx: 'QQ音乐', kg: '酷狗', mg: '咪咕'
}

export function SourceBadge({ platform, text }: { platform?: string; text?: string }): JSX.Element {
  const plat = platform ?? ''
  const label = PLATFORM_LABEL[plat] ?? plat
  return <span className={'src-badge plat-' + plat}>{text ?? label}</span>
}
