'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mutate } from 'swr'
import { post } from '@/lib/hooks'
import type { CheckBatchResult } from '@/lib/types'

const STORAGE_KEY = 'proxy-ledger:check-job:v2'

export type CheckFailure = { id: number; reason: string }

export type CheckJobState = {
  running: boolean
  cursor: number
  upperBound: number
  total: number
  checked: number
  healthy: number
  failed: number
  onlyDead: boolean
  startedAt: number | null
  error: string | null
  resumable: boolean
  recent: CheckFailure[]
}

const IDLE: CheckJobState = {
  running: false,
  cursor: 0,
  upperBound: 0,
  total: 0,
  checked: 0,
  healthy: 0,
  failed: 0,
  onlyDead: false,
  startedAt: null,
  error: null,
  resumable: false,
  recent: [],
}

type CheckJobContextValue = {
  state: CheckJobState
  start: (onlyDead: boolean) => void
  resume: () => void
  stop: () => void
  reset: () => void
}

const CheckJobContext = createContext<CheckJobContextValue>({
  state: IDLE,
  start: () => {},
  resume: () => {},
  stop: () => {},
  reset: () => {},
})

export function useCheckJob() {
  return useContext(CheckJobContext)
}

/**
 * Drives the health-check sweep from the browser in small server batches, so a
 * long run never depends on one serverless invocation staying alive. Progress is
 * mirrored into sessionStorage so an interrupted sweep can be resumed.
 */
export function CheckJobProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CheckJobState>(IDLE)
  const runningRef = useRef(false)
  const stopRef = useRef(false)

  useEffect(() => {
    try {
      sessionStorage.removeItem('proxy-ledger:check-job')
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as CheckJobState
      if (saved.upperBound && saved.cursor < saved.upperBound) {
        setState({ ...saved, running: false, resumable: true, error: null, recent: saved.recent ?? [] })
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const persist = useCallback((next: CheckJobState) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage can be unavailable in private modes; the run still works in memory.
    }
  }, [])

  const run = useCallback(
    async (onlyDead: boolean, from?: CheckJobState) => {
      if (runningRef.current) return
      runningRef.current = true
      stopRef.current = false

      let current: CheckJobState = from
        ? { ...from, running: true, error: null, resumable: false }
        : { ...IDLE, running: true, onlyDead, startedAt: Date.now() }

      setState(current)
      persist(current)

      try {
        for (;;) {
          if (stopRef.current) break

          const data = await post<CheckBatchResult>({
            action: 'check-batch',
            cursor: current.cursor,
            upperBound: current.upperBound,
            onlyDead: current.onlyDead,
          })

          const failures = data.results
            .filter((item) => item.status === 'dead')
            .map((item) => ({ id: item.id, reason: item.reason }))

          current = {
            ...current,
            cursor: data.cursor,
            upperBound: data.upperBound,
            total: data.total ?? current.total,
            checked: current.checked + data.results.length,
            healthy: current.healthy + data.healthy,
            failed: current.failed + data.failed,
            recent: [...failures, ...current.recent].slice(0, 6),
          }
          setState(current)
          persist(current)

          await mutate((key) => typeof key === 'string' && key.startsWith('/api/dashboard?view=proxies'))

          if (data.done) break
        }

        const finished: CheckJobState = { ...current, running: false, resumable: false }
        setState(finished)
        persist(finished)
        await mutate('/api/dashboard?view=overview')
        await mutate('/api/dashboard?view=health')
      } catch (error) {
        const failed: CheckJobState = {
          ...current,
          running: false,
          resumable: true,
          error: error instanceof Error ? error.message : 'Lỗi kiểm tra',
        }
        setState(failed)
        persist(failed)
      } finally {
        runningRef.current = false
      }
    },
    [persist],
  )

  const value = useMemo<CheckJobContextValue>(
    () => ({
      state,
      start: (onlyDead: boolean) => void run(onlyDead),
      resume: () => void run(state.onlyDead, state),
      stop: () => {
        stopRef.current = true
      },
      reset: () => {
        stopRef.current = true
        setState(IDLE)
        try {
          sessionStorage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
      },
    }),
    [run, state],
  )

  return <CheckJobContext.Provider value={value}>{children}</CheckJobContext.Provider>
}
