import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const LANGS = [
  { code: 'en',  short: 'EN',  name: 'English',    flag: '🇬🇧' },
  { code: 'sw',  short: 'SW',  name: 'Kiswahili',  flag: '🇰🇪' },
  { code: 'rny', short: 'RNY', name: 'Runyankole', flag: '🇺🇬' },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = LANGS.find(l => (i18n.language || 'en').startsWith(l.code)) ?? LANGS[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      {/* Collapsed trigger: flag + short code */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Change language"
        className="flex items-center gap-1 rounded-[8px] border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs font-semibold text-[var(--foreground)] active:scale-95"
      >
        <span className="text-sm leading-none">{cur.flag}</span>
        {cur.short}
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {/* Expanded menu: red label + full names with flags */}
      {open && (
        <div className="bubble-pop absolute right-0 top-[calc(100%+6px)] z-50 w-44 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]" style={{ boxShadow: '0 12px 32px rgba(0,0,0,.5)' }}>
          <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#f87171' }}>Language</div>
          {LANGS.map(l => {
            const active = l.code === cur.code
            return (
              <button
                key={l.code}
                onClick={() => { i18n.changeLanguage(l.code); setOpen(false) }}
                className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--card)]', active ? 'text-[var(--foreground)]' : 'text-[var(--muted)]')}
              >
                <span className="text-base leading-none">{l.flag}</span>
                <span className="flex-1 font-medium">{l.name}</span>
                <span className="text-[10px] text-[var(--muted-2)]">{l.short}</span>
                {active && <Check size={14} className="text-[#4ade80]" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
