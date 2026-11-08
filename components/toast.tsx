'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Toast = { id: number; message: string; tone: 'info' | 'error' }

const ToastContext = createContext<{ push: (message: string, tone?: Toast['tone']) => void }>({
  push: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rise panel pointer-events-auto flex max-w-sm items-start gap-2.5 px-3.5 py-2.5 shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.25)]"
          >
            <span
              aria-hidden
              className={toast.tone === 'error' ? 'dot mt-1.5 text-destructive' : 'dot mt-1.5 text-foreground'}
            />
            <p className="text-[12px] leading-relaxed">{toast.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
