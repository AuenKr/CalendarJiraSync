import { useEffect, useState } from 'react'
import { useConfigStore } from './useConfigStore'

export function useConfigStoreHydrated() {
  const [hydrated, setHydrated] = useState(useConfigStore.persist.hasHydrated())

  useEffect(() => {
    const unsubscribeHydrate = useConfigStore.persist.onHydrate(() => {
      setHydrated(false)
    })

    const unsubscribeFinishHydration = useConfigStore.persist.onFinishHydration(() => {
      setHydrated(true)
    })

    return () => {
      unsubscribeHydrate()
      unsubscribeFinishHydration()
    }
  }, [])

  return hydrated
}
