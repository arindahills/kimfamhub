/** Mirrors livestock.LIVESTOCK in the backend (ADR-029). The backend is the gate; this only
 *  decides what to show. */
export type LivestockId = 'sheep' | 'goats'

export interface LivestockCfg {
  noun: string
  plural: string
  writers: string[]            // + admins
  eventTypes: string[]
  expenseCategories: string[]
  ownedBy: 'club' | 'owners'
  owners: { name: string; display: string }[]
}

const GOAT_OWNERS = [
  ['Israel', 'Dad (Israel)'], ['Merab', 'Mum (Merab)'], ['Hillary', 'Hillary'], ['Alex', 'Alex'],
  ['Priscilla', 'Priscilla'], ['Max', 'Max'], ['Janet', 'Janet'], ['Viola', 'Viola'],
  ['Simon', 'Simon'], ['Esther', 'Esther'], ['Lawi', 'Lawi'],
].map(([name, display]) => ({ name, display }))

export const LIVESTOCK: Record<LivestockId, LivestockCfg> = {
  sheep: {
    noun: 'sheep', plural: 'sheep', writers: ['Solomon'],
    eventTypes: ['death', 'birth', 'sale', 'purchase'],
    expenseCategories: ['vet', 'ear_tag', 'pasture', 'feed_silage', 'sourcing', 'transport', 'labour', 'other'],
    ownedBy: 'club', owners: [],
  },
  goats: {
    noun: 'goat', plural: 'goats', writers: ['Solomon', 'Merab'],
    eventTypes: ['opening', 'death', 'birth', 'sale', 'purchase'],
    expenseCategories: ['vet', 'feed', 'pasture', 'transport', 'labour', 'other'],
    ownedBy: 'owners', owners: GOAT_OWNERS,
  },
}

export const isLivestock = (id: string): id is LivestockId => id in LIVESTOCK

export const ownerDisplay = (cfg: LivestockCfg, name?: string | null) =>
  !name ? 'unassigned' : (cfg.owners.find(o => o.name === name)?.display ?? name)

// The shared farm device (Dad, Solomon, Mum) must not need to know URL shapes.
export const livestockApi = (id: LivestockId) => ({
  detail: `/api/projects/${id}/detail`,
  event: `/api/projects/${id}/livestock/event`,
  expense: `/api/projects/${id}/livestock/expense`,
  remove: (kind: 'event' | 'expense', rowId: number) => `/api/projects/${id}/livestock/${kind}/${rowId}`,
})
