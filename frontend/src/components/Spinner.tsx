import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

/** Inline spinner. Size in px; colour inherits or via `color`. */
export function Spinner({ size = 16, color = '#93c5fd', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', width: size, height: size,
        border: `2px solid ${color}33`, borderTopColor: color,
        borderRadius: '50%', animation: 'kf-spin 0.7s linear infinite',
        ...style,
      }}
    />
  )
}

/** Full-area loading state: centered spinner + optional label. Use while a panel loads. */
export function Loading({ label = 'Loading…', minHeight = 160 }: { label?: string; minHeight?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight, color: '#64748b' }}>
      <Spinner size={22} />
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  )
}

type BusyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean
  busyLabel?: string
  children: ReactNode
}

/** A button that shows a spinner and disables itself while a server task runs.
 *  Drop-in for any <button>: pass `busy` from your async state. */
export function BusyButton({ busy, busyLabel, children, disabled, style, ...rest }: BusyButtonProps) {
  return (
    <button
      {...rest}
      disabled={busy || disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: (busy || disabled) ? 0.7 : 1, cursor: (busy || disabled) ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {busy && <Spinner size={14} color="currentColor" />}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  )
}
