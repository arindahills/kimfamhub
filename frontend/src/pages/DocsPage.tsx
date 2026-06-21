import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

interface DocFile {
  name: string
  file: string
  url: string
}

interface DocGroup {
  label: string
  files: DocFile[]
}

interface DocCategory {
  label: string
  count: number
  groups: DocGroup[]
}

type DocsData = Record<string, DocCategory>

const CAT_ICONS: Record<string, string> = {
  minutes: '📋',
  governance: '📜',
  projects: '🌾',
  financial: '💰',
  receipts: '🧾',
}

// Brand-coloured book emoji map to the Office apps: Word=blue, Excel=green,
// PowerPoint=orange, PDF=red.
const EXT_ICONS: Record<string, string> = {
  docx: '📘', doc: '📘', xlsx: '📗', xls: '📗', pptx: '📙', ppt: '📙', pdf: '📕', default: '📄',
}

function ext(filename: string) {
  return filename.split('.').pop()?.toLowerCase() || 'default'
}

function fileBase(p: string) {
  // p may be "Sub Group/Name.docx" — show just the leaf for the View link basename
  return p.split('/').pop() || p
}

export default function DocsPage() {
  const { t } = useTranslation()
  const [openCat, setOpenCat] = useState<string | null>('minutes')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const toggleGroup = (cat: string, label: string) => {
    const key = `${cat}::${label}`
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const { data, isLoading } = useQuery<DocsData>({
    queryKey: ['docs'],
    queryFn: () => fetch('/api/docs', { credentials: 'include' }).then(r => r.json()),
  })

  // Per-document AI summary (Haiku, cached server-side by content hash)
  const qc = useQueryClient()
  const [summaryDoc, setSummaryDoc] = useState<{ path: string; name: string } | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState('')
  const { data: sum, isFetching: sumLoading, error: sumError } = useQuery<{ summary: string; cached: boolean }>({
    queryKey: ['doc-summary', summaryDoc?.path],
    enabled: !!summaryDoc,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/docs/summary?path=${encodeURIComponent(summaryDoc!.path)}`, { credentials: 'include' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({} as any))).detail || 'Could not load summary')
      return r.json()
    },
  })
  const regenerate = async () => {
    if (!summaryDoc) return
    setRegenerating(true); setRegenError('')
    try {
      const r = await fetch(`/api/docs/summary?refresh=true&path=${encodeURIComponent(summaryDoc.path)}`, { credentials: 'include' })
      if (r.ok) qc.setQueryData(['doc-summary', summaryDoc.path], await r.json())
      else setRegenError((await r.json().catch(() => ({} as any))).detail || 'Could not regenerate')
    } catch { setRegenError('Could not regenerate') }
    finally { setRegenerating(false) }
  }
  const docPathOf = (url: string) => url.replace(/^\/docs\//, '')

  const q = search.trim().toLowerCase()
  const filtered: DocsData | undefined = !data ? data : q === '' ? data : Object.fromEntries(
    Object.entries(data).map(([key, cat]) => {
      const groups = (cat.groups || [])
        .map(g => ({ ...g, files: g.files.filter(f => f.name.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) }))
        .filter(g => g.files.length > 0)
      return [key, { ...cat, groups, count: groups.reduce((s, g) => s + g.files.length, 0) }]
    })
  )

  if (isLoading) return <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading…</p>

  const categories = Object.entries(filtered || {})
  const resultCount = categories.reduce((sum, [, cat]) => sum + (cat.count || 0), 0)

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-2">
      <div style={{ padding: '0.5rem 0' }}>
        <input
          type="text"
          placeholder={t('documents.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '0.75rem 1rem', borderRadius: '0.5rem',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        />
        {search && <p style={{ fontSize: '10px', marginTop: '0.25rem', color: '#475569' }}>{resultCount} results</p>}
      </div>

      {categories.map(([key, cat]) => {
        const isOpen = openCat === key || q !== ''
        return (
          <div key={key} className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            <button
              onClick={() => setOpenCat(isOpen && q === '' ? null : key)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span>{CAT_ICONS[key] || '📁'}</span>
                <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{cat.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#1e293b', color: '#64748b' }}>
                  {cat.count}
                </span>
              </div>
              <span style={{ color: '#475569', transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
            </button>

            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {(cat.groups || []).length === 0 && (
                  <p className="text-xs px-4 py-3" style={{ color: 'var(--text-muted)' }}>No documents yet.</p>
                )}
                {(cat.groups || []).map(group => {
                  const groupOpen = openGroups.has(`${key}::${group.label}`) || q !== ''
                  return (
                  <div key={group.label}>
                    {/* sub-group header (collapsible) */}
                    <button
                      onClick={() => toggleGroup(key, group.label)}
                      className="w-full flex items-center justify-between px-4 py-2"
                      style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#7c93b3', letterSpacing: '0.04em' }}>
                          {group.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#1e293b', color: '#64748b' }}>
                          {group.files.length}
                        </span>
                      </div>
                      <span style={{ color: '#475569', fontSize: 11, transform: groupOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
                    </button>
                    {groupOpen && group.files.map((f, i) => (
                      <div key={f.file} className="flex items-center justify-between px-4 py-3"
                        style={{ paddingLeft: '1.5rem', borderBottom: i < group.files.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-sm shrink-0">{EXT_ICONS[ext(fileBase(f.file))] || EXT_ICONS.default}</span>
                          <span className="text-sm truncate" style={{ color: '#cbd5e1' }}>{f.name}</span>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-2">
                          {['docx', 'pdf', 'pptx', 'xlsx'].includes(ext(fileBase(f.file))) && (
                            <button onClick={() => { setRegenError(''); setSummaryDoc({ path: docPathOf(f.url), name: f.name }) }}
                              className="text-[11px] px-2 py-1 rounded" style={{ background: '#3b2f1e', color: '#fcd34d' }}>
                              Summary
                            </button>
                          )}
                          <a href={`${encodeURI(f.url)}/view`} target="_blank" rel="noreferrer"
                            className="text-[11px] px-2 py-1 rounded" style={{ background: '#1e3a5f', color: '#93c5fd' }}>
                            View
                          </a>
                          <a href={encodeURI(f.url)} download
                            className="text-[11px] px-2 py-1 rounded" style={{ background: '#1e293b', color: '#64748b' }}>
                            ↓
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )})}
              </div>
            )}
          </div>
        )
      })}

      {summaryDoc && (
        <div onClick={() => setSummaryDoc(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20, border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between mb-3 gap-3">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>📄 {summaryDoc.name}</h3>
              <button onClick={() => setSummaryDoc(null)} style={{ color: '#64748b', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            {(sumLoading || regenerating) && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Generating summary…</p>}
            {sumError && !sumLoading && <p className="text-xs" style={{ color: '#f87171' }}>{String((sumError as Error).message || sumError)}</p>}
            {regenError && <p className="text-xs mt-2" style={{ color: '#f87171' }}>{regenError}</p>}
            {sum?.summary && !regenerating && (
              <div className="text-sm" style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{sum.summary}</div>
            )}
            {sum && !sumLoading && (
              <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-[10px]" style={{ color: '#475569' }}>{sum.cached ? 'Cached' : 'Freshly generated'} · Haiku</span>
                <button onClick={regenerate} disabled={regenerating}
                  className="text-[11px] px-2 py-1 rounded disabled:opacity-60" style={{ background: '#1e293b', color: '#93c5fd' }}>
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
