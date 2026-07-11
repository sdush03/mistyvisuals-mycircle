'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

type Toast = {
  id: string
  title: string
  message: string
  type: string
  linkUrl: string | null
  isActionRequired: boolean
}

export default function ToastNotifications() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const prevIdsRef = useRef<Set<string>>(new Set())
  const isFirstLoad = useRef(true)
  const router = useRouter()

  const { data } = useSWR('/api/notifications', fetcher, {
    refreshInterval: 5000,
  })

  useEffect(() => {
    if (!data?.notifications) return

    const current = data.notifications as any[]

    if (isFirstLoad.current) {
      // Seed known IDs without showing toasts
      current.forEach(n => prevIdsRef.current.add(n.id))
      isFirstLoad.current = false
      return
    }

    // Find new ones that we haven't seen yet
    const newOnes = current.filter(
      n => !prevIdsRef.current.has(n.id) && !n.is_read && n.is_action_required
    )

    if (newOnes.length > 0) {
      newOnes.forEach(n => prevIdsRef.current.add(n.id))
      const newToasts: Toast[] = newOnes.slice(0, 3).map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        linkUrl: n.link_url,
        isActionRequired: n.is_action_required,
      }))
      setToasts(prev => [...prev, ...newToasts])
      // Auto-dismiss after 6s
      newToasts.forEach(t => {
        setTimeout(() => dismissToast(t.id), 6000)
      })
    } else {
      // Seed any new IDs we see (even read ones)
      current.forEach(n => prevIdsRef.current.add(n.id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const handleToastClick = (toast: Toast) => {
    dismissToast(toast.id)
    if (toast.linkUrl) router.push(toast.linkUrl)
  }

  if (toasts.length === 0) return null

  const bgColors: Record<string, string> = {
    ERROR: 'border-rose-200 bg-rose-50',
    WARNING: 'border-amber-200 bg-amber-50',
    SUCCESS: 'border-emerald-200 bg-emerald-50',
    INFO: 'border-blue-200 bg-blue-50',
  }
  const dotColors: Record<string, string> = {
    ERROR: 'bg-rose-500',
    WARNING: 'bg-amber-500',
    SUCCESS: 'bg-emerald-500',
    INFO: 'bg-blue-500',
  }
  const titleColors: Record<string, string> = {
    ERROR: 'text-rose-900',
    WARNING: 'text-amber-900',
    SUCCESS: 'text-emerald-900',
    INFO: 'text-blue-900',
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-2 items-center pointer-events-none"
      style={{ width: 'min(380px, calc(100vw - 32px))' }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`w-full pointer-events-auto rounded-2xl border shadow-lg px-4 py-3.5 flex items-start gap-3 cursor-pointer transition-all hover:shadow-xl ${bgColors[toast.type] || bgColors.INFO}`}
          style={{ animation: 'mv-toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          onClick={() => handleToastClick(toast)}
        >
          <style>{`
            @keyframes mv-toast-in {
              from { opacity: 0; transform: translateY(16px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
          {/* Dot */}
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 animate-pulse ${dotColors[toast.type] || dotColors.INFO}`} />
          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={`text-[13px] font-bold leading-snug ${titleColors[toast.type] || titleColors.INFO}`}>
              {toast.title}
            </p>
            <p className="text-[12px] text-neutral-600 leading-snug mt-0.5 line-clamp-2">
              {toast.message}
            </p>
          </div>
          {/* Dismiss */}
          <button
            onClick={(e) => { e.stopPropagation(); dismissToast(toast.id) }}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 transition mt-0.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
