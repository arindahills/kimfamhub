import { useTranslation } from 'react-i18next'

const LANGS = [
  { code: 'en',  label: 'EN' },
  { code: 'sw',  label: 'SW' },
  { code: 'rny', label: 'RNY' },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()

  return (
    <div className="flex gap-1">
      {LANGS.map(l => (
        <button
          key={l.code}
          onClick={() => i18n.changeLanguage(l.code)}
          className="px-2 py-0.5 rounded text-xs font-medium transition-opacity"
          style={{
            background: i18n.language === l.code ? 'var(--accent)' : 'var(--bg-card)',
            color: i18n.language === l.code ? '#fff' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            opacity: i18n.language === l.code ? 1 : 0.7,
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
