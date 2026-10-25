import { useEffect, useState } from 'react'

export function useLimbusVisible(): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let alive = true
    let receivedEvent = false
    const off = window.glass.onLimbusState(value => { receivedEvent = true; setVisible(value) })
    void window.glass.limbusVisible().then(value => {
      if (alive && !receivedEvent) setVisible(value)
    }).catch(() => {})
    return () => { alive = false; off() }
  }, [])
  return visible
}
