import { Link } from 'react-router-dom'

/** A small row of "related module" chips for cross-navigation between pages. */
export default function CrossLinks({ links }: { links: { to: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-3">
      <span className="text-[10px]" style={{ color: '#475569' }}>Related:</span>
      {links.map(l => (
        <Link key={l.to} to={l.to}
          className="text-[11px] px-2.5 py-1 rounded-full hover:brightness-110"
          style={{ background: '#1e293b', color: '#93c5fd', border: '1px solid #334155', textDecoration: 'none' }}>
          {l.label}
        </Link>
      ))}
    </div>
  )
}
