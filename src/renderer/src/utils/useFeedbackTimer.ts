import { useCallback, useEffect, useRef } from 'preact/hooks'

export interface FeedbackTimer {
  /** Runs `fn` after `ms`, unless the component unmounts first. */
  schedule: (fn: () => void, ms: number) => void
  /** False once the component has unmounted — guard async setState with it. */
  mounted: { readonly current: boolean }
}

/**
 * Transient "copied"/"downloaded" feedback timers that clean themselves up. These used to be
 * bare `setTimeout` calls that fired into unmounted components (P-06).
 */
export function useFeedbackTimer(): FeedbackTimer {
  const mounted = useRef(true)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const timer of pending) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const schedule = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      if (mounted.current) fn()
    }, ms)
    timers.current.add(timer)
  }, [])

  return { schedule, mounted }
}
