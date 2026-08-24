import { useEffect } from 'react'
import Mock3App from './Mock3App'
import { reloadOnceIfUpgraded, versionLabel } from './version'

export default function App() {
  // Store running build version; self-heal stale cached bundles; set document title
  useEffect(() => {
    const info = reloadOnceIfUpgraded()
    if (typeof document !== 'undefined') {
      document.title = `Smart Survey X ${versionLabel()}`
    }
    if (info.upgraded) {
      console.info(`[Smart Survey X] upgraded ${info.prev} → ${info.current}`)
    }
  }, [])

  return <Mock3App />
}
