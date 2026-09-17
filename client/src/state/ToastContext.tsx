import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Tone = 'info' | 'success' | 'warn' | 'error'

interface Toast {
  id: number
  tone: Tone
  message: string
}

interface ToastValue {
  notify: (message: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const STYLES: Record<Tone, string> = {
  info: 'border-ink/25 bg-white text-ink',
  success: 'border-pine bg-pine text-paper',
  warn: 'border-gold bg-gold text-ink',
  error: 'border-seal bg-seal text-paper'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const notify = useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current.slice(-3), { id, tone, message }])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200)
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="no-print pointer-events-none fixed right-3 top-3 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <output
            key={t.id}
            className={`pointer-events-auto border px-3 py-2 font-sans text-sm shadow-sm ${STYLES[t.tone]}`}
          >
            {t.message}
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
