// WalkthroughOverlay — spotlight tour ported from vanilla JS showWalkthrough()
// Shows on first login (localStorage 'kimfam_onboarded' absent).
// Replay trigger: dispatch CustomEvent 'kimfam:startTour' from anywhere.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

interface Step {
  tourId: string | null
  icon: string
  title: string
  body: string
  route: string | null
  optional?: boolean
}

const STEPS: Step[] = [
  {
    tourId: null,
    icon: '👋',
    title: 'Welcome to KimFam Hub!',
    body: "This is your family's investment club app. Let's take a quick tour so you know exactly where everything is.",
    route: null,
  },
  {
    tourId: 'nav-finances',
    icon: '💰',
    title: 'Finances',
    body: "Track every family's monthly contributions, opening balances, and outstanding amounts. Green means paid up. Tap Submit a Payment to record yours.",
    route: '/finances',
  },
  {
    tourId: 'submit-payment',
    icon: '📤',
    title: 'Submit a Payment',
    body: 'Select your family, enter the amount, attach your bank or MoMo receipt, then allocate. Hellen (Treasurer) confirms on her side.',
    route: '/finances',
    optional: true,
  },
  {
    tourId: 'nav-members',
    icon: '👨‍👩‍👧‍👦',
    title: 'Members',
    body: 'Browse all club members and their families. Tap any family card to see the full family tree, birthdays, and investment profile.',
    route: '/members',
  },
  {
    tourId: 'nav-projects',
    icon: '🌾',
    title: 'Projects',
    body: 'Track all club investments — sheep, chicken, washing bay, and more. See progress updates, budgets, and team assignments.',
    route: '/projects',
  },
  {
    tourId: 'nav-expenditure',
    icon: '💸',
    title: 'Expenditure',
    body: 'All club expenses by year, category, and project. Admins can add expenses with receipts here. Tap More to find it.',
    route: '/expenditure',
  },
  {
    tourId: 'nav-actions',
    icon: '✅',
    title: 'Action Points',
    body: 'Every club decision and who owns it. You get a WhatsApp reminder as your deadline approaches. Tap More to find it.',
    route: '/actions',
  },
  {
    tourId: 'nav-updates',
    icon: '📰',
    title: 'Updates',
    body: 'Latest news from all projects — sheep, chicken, washing bay, and more. Project managers post here. Tap More to find it.',
    route: '/updates',
  },
  {
    tourId: 'nav-equity',
    icon: '⚖️',
    title: 'Family Equity',
    body: "See how club expenses are shared across all seven families under Models A, B, and C. Cast your family's vote here. Tap More to find it.",
    route: '/equity',
  },
  {
    tourId: 'nav-ask',
    icon: '🤖',
    title: 'Ask KimFam',
    body: 'Ask anything — your balance, meeting decisions, club rules, project status, or how to use the app. The AI reads all club documents.',
    route: '/ask',
  },
]

const PAD = 10

function computeSpotlight(el: Element) {
  const r = el.getBoundingClientRect()
  const x = r.left - PAD, y = r.top - PAD
  const w = r.width + PAD * 2, h = r.height + PAD * 2
  const rx = 10
  const vw = window.innerWidth, vh = window.innerHeight
  const path =
    `M0,0 H${vw} V${vh} H0 Z ` +
    `M${x + rx},${y} H${x + w - rx} Q${x + w},${y} ${x + w},${y + rx} ` +
    `V${y + h - rx} Q${x + w},${y + h} ${x + w - rx},${y + h} ` +
    `H${x + rx} Q${x},${y + h} ${x},${y + h - rx} ` +
    `V${y + rx} Q${x},${y} ${x + rx},${y} Z`
  return { path, x, y, w, h, vw, vh }
}

interface SpotState {
  path: string; x: number; y: number; w: number; h: number; vw: number; vh: number
}

async function waitForEl(tourId: string, maxMs = 2000): Promise<Element | null> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const el = document.querySelector(`[data-tour="${tourId}"]`)
    if (el) return el
    await new Promise(r => requestAnimationFrame(r))
    await new Promise(r => setTimeout(r, 60))
  }
  return null
}

export function WalkthroughOverlay() {
  const navigate = useNavigate()
  const location = useLocation()
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [spot, setSpot] = useState<SpotState | null>(null)
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setActive(false)
    localStorage.setItem('kimfam_onboarded', '1')
    // dispatch close-drawer signal just in case
    window.dispatchEvent(new CustomEvent('kimfam:closeDrawer'))
  }, [])

  // Check first-visit
  useEffect(() => {
    if (!localStorage.getItem('kimfam_onboarded')) {
      setTimeout(() => setActive(true), 800)
    }
  }, [])

  // Listen for replay trigger
  useEffect(() => {
    const handler = () => { setStep(0); setActive(true) }
    window.addEventListener('kimfam:startTour', handler)
    return () => window.removeEventListener('kimfam:startTour', handler)
  }, [])

  // Render the current step whenever step or route changes
  useEffect(() => {
    if (!active) return
    let cancelled = false

    const run = async () => {
      const s = STEPS[step]
      if (!s.tourId) {
        setSpot(null)
        positionTooltipCentered()
        return
      }
      // Navigate if needed
      if (s.route && location.pathname !== s.route) {
        // Signal drawer open if target is in drawer
        window.dispatchEvent(new CustomEvent('kimfam:openDrawer'))
        navigate(s.route)
        await new Promise(r => setTimeout(r, 500))
      } else {
        // Open drawer if this is a drawer-only item
        // Bottom-tab items don't need the drawer open; drawer items do
      const isDirect = ['nav-finances', 'nav-members', 'nav-projects', 'nav-ask'].includes(s.tourId)
        if (!isDirect) window.dispatchEvent(new CustomEvent('kimfam:openDrawer'))
        await new Promise(r => setTimeout(r, 250))
      }
      if (cancelled) return

      const el = await waitForEl(s.tourId)
      if (cancelled) return

      if (!el) {
        if (s.optional) { nextStep(); return }
        setSpot(null); positionTooltipCentered(); return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await new Promise(r => setTimeout(r, 450))
      if (cancelled) return

      const sp = computeSpotlight(el)
      setSpot(sp)
      positionTooltipNear(sp)
    }

    run()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, active])

  function positionTooltipCentered() {
    setTimeout(() => {
      if (!tooltipRef.current) return
      const ttH = tooltipRef.current.offsetHeight || 220
      const ttW = tooltipRef.current.offsetWidth || 300
      const vw = window.innerWidth, vh = window.innerHeight
      setTooltip({
        top: Math.max(16, (vh - ttH) / 2),
        left: Math.max(16, (vw - ttW) / 2),
      })
    }, 30)
  }

  function positionTooltipNear(sp: SpotState) {
    setTimeout(() => {
      if (!tooltipRef.current) return
      const ttH = tooltipRef.current.offsetHeight || 220
      const ttW = tooltipRef.current.offsetWidth || 300
      const margin = 14
      let top: number
      if (sp.y + sp.h + ttH + margin < sp.vh) {
        top = sp.y + sp.h + margin
      } else if (sp.y - ttH - margin > 0) {
        top = sp.y - ttH - margin
      } else {
        top = Math.max(margin, (sp.vh - ttH) / 2)
      }
      const left = Math.max(margin, Math.min(sp.x + sp.w / 2 - ttW / 2, sp.vw - ttW - margin))
      setTooltip({ top, left })
    }, 30)
  }

  function nextStep() {
    if (step < STEPS.length - 1) {
      window.dispatchEvent(new CustomEvent('kimfam:closeDrawer'))
      setStep(s => s + 1)
    } else {
      close()
    }
  }

  if (!active) return null

  const s = STEPS[step]
  const vw = window.innerWidth, vh = window.innerHeight

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, pointerEvents: 'all' }}>
      {/* SVG overlay with hole */}
      <svg width={vw} height={vh} style={{ position: 'absolute', inset: 0, display: 'block' }}>
        <defs>
          <clipPath id="wt-clip">
            <path d={spot?.path ?? `M0,0 H${vw} V${vh} H0 Z`} />
          </clipPath>
        </defs>
        <rect width={vw} height={vh} fill="rgba(0,0,0,0.72)" clipPath="url(#wt-clip)" />
        {spot && (
          <rect
            x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={PAD}
            fill="none" stroke="#22c55e" strokeWidth={2.5}
            style={{ animation: 'wt-border-pulse 1.5s ease-in-out infinite' }}
          />
        )}
      </svg>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: tooltip?.top ?? '50%',
          left: tooltip?.left ?? '50%',
          width: Math.min(300, vw - 32),
          background: '#0d1829',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '20px 20px 16px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          zIndex: 9001,
        }}
      >
        {/* step label + icon */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#475569' }}>Step {step + 1} of {STEPS.length}</span>
          <span style={{ fontSize: 22 }}>{s.icon}</span>
        </div>

        {/* title */}
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>{s.title}</div>

        {/* body */}
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, marginBottom: 16 }}>{s.body}</div>

        {/* dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: 14 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: '50%',
              background: i === step ? '#22c55e' : '#334155',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        {/* buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={close}
            style={{
              flex: 1, background: '#1e293b', color: '#64748b',
              border: '1px solid #334155', borderRadius: 10,
              padding: '10px 0', fontSize: 13, cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <button
            onClick={nextStep}
            style={{
              flex: 2, background: '#166534', color: '#fff',
              border: 'none', borderRadius: 10,
              padding: '10px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {step === STEPS.length - 1 ? "Let's go! ✓" : 'Next →'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes wt-border-pulse {
          0%, 100% { stroke-opacity: 0.6; }
          50%       { stroke-opacity: 1;   }
        }
      `}</style>
    </div>
  )
}
