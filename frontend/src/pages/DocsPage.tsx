import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface DocFile {
  name: string
  file: string
  url: string
}

interface DocCategory {
  label: string
  files: DocFile[]
}

type DocsData = Record<string, DocCategory>

const CAT_ICONS: Record<string, string> = {
  minutes: '📋',
  governance: '📜',
  projects: '🌾',
  financial: '💰',
  receipts: '🧾',
}

const EXT_ICONS: Record<string, string> = {
  docx: '📄', pdf: '📕', default: '📄',
}

function ext(filename: string) {
  return filename.split('.').pop()?.toLowerCase() || 'default'
}

export default function DocsPage() {
  const [openCat, setOpenCat] = useState<string | null>('minutes')

  const { data, isLoading } = useQuery<DocsData>({
    queryKey: ['docs'],
    queryFn: () => fetch('/api/docs', { credentials: 'include' }).then(r => r.json()),
  })

  if (isLoading) return <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading...</p>

  const categories = Object.entries(data || {})

  return (
    <div className="max-w-2xl mx-auto space-y-2">
      {categories.map(([key, cat]) => {
        const isOpen = openCat === key
        return (
          <div key={key} className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            <button
              onClick={() => setOpenCat(isOpen ? null : key)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span>{CAT_ICONS[key] || '📁'}</span>
                <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {cat.label}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background: '#1e293b', color: '#64748b' }}>
                  {cat.files.length}
                </span>
              </div>
              <span style={{ color: '#475569', transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
            </button>

            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {cat.files.length === 0 && (
                  <p className="text-xs px-4 py-3" style={{ color: 'var(--text-muted)' }}>No documents yet.</p>
                )}
                {cat.files.map((f, i) => (
                  <div key={f.file} className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < cat.files.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm shrink-0">{EXT_ICONS[ext(f.file)] || EXT_ICONS.default}</span>
                      <span className="text-sm truncate" style={{ color: '#cbd5e1' }}>{f.name}</span>
                    </div>
                    <div className="flex gap-2 shrink-0 ml-2">
                      <a href={`${f.url}/view`} target="_blank" rel="noreferrer"
                        className="text-[11px] px-2 py-1 rounded"
                        style={{ background: '#1e3a5f', color: '#93c5fd' }}>
                        View
                      </a>
                      <a href={f.url} download
                        className="text-[11px] px-2 py-1 rounded"
                        style={{ background: '#1e293b', color: '#64748b' }}>
                        ↓
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
