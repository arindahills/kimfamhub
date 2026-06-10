import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** UGX currency with thousands separators. */
export function ugx(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return 'UGX 0'
  return 'UGX ' + Math.round(n).toLocaleString('en-US')
}

/** Relative "time ago" that never returns NaN. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
