export interface FamilyMember {
  name: string
  role: string
  birthday: string | null   // "10 Oct 1990" (full) | "26 Jan" (day+month only) | null
  avatarKey: string         // maps to /static/avatars/{key}.jpg
  isHead?: boolean
}

export interface FamilyChild {
  name: string
  birthday: string | null
}

export interface FamilyNode {
  key: string
  label: string
  initial: string
  color: string
  birthOrder: number        // 0 = root/parents, 1–6 = children
  members: FamilyMember[]
  children: FamilyChild[]
}

export const FAMILY_TREE: FamilyNode[] = [
  {
    key: 'kikangis',
    label: 'The Kikangis',
    initial: 'K',
    color: '#f59e0b',
    birthOrder: 0,
    members: [
      { name: 'Israel Kikangi', role: 'Chairman', birthday: '7 Aug 1954', avatarKey: 'israelkikangi', isHead: true },
      { name: 'Merab Kikangi', role: 'Member', birthday: '8 Aug 1964', avatarKey: 'merabkikangi' },
    ],
    children: [],
  },
  {
    key: 'tuhimbises',
    label: 'The Tuhimbises',
    initial: 'T',
    color: '#06b6d4',
    birthOrder: 1,
    members: [
      { name: 'Alex Tuhimbise', role: '1st born', birthday: '26 Jan 1983', avatarKey: 'alextuhimbise', isHead: true },
      { name: 'Priscilla Tuhimbise', role: "Alex's wife", birthday: '2 Feb', avatarKey: 'priscillatuhimbise' },
    ],
    children: [
      { name: 'Alexa', birthday: '19 Jun' },
      { name: 'Alicia', birthday: '21 Jan' },
      { name: 'Elijah', birthday: '2 Aug 2020' },
      { name: 'Elsie', birthday: null },
      { name: 'Izeal', birthday: null },
    ],
  },
  {
    key: 'turamyes',
    label: 'The Turamyes',
    initial: 'T',
    color: '#8b5cf6',
    birthOrder: 2,
    members: [
      { name: 'Max Turamye', role: '2nd born', birthday: '16 Aug 1984', avatarKey: 'maxturamye', isHead: true },
      { name: 'Janet Turamye', role: "Max's wife", birthday: '24 Jan', avatarKey: 'janetturamye' },
    ],
    children: [
      { name: 'Jonathan', birthday: null },
      { name: 'Abigail', birthday: '14 Aug' },
      { name: 'Nikita', birthday: '11 Nov 2022' },
    ],
  },
  {
    key: 'arungas',
    label: 'The Arungas',
    initial: 'A',
    color: '#ec4899',
    birthOrder: 3,
    members: [
      { name: 'Viola Arunga', role: '3rd born', birthday: '4 Nov 1986', avatarKey: 'violaarunga', isHead: true },
      { name: 'Simon Arunga', role: "Viola's husband", birthday: '3 May', avatarKey: 'simonarunga' },
    ],
    children: [
      { name: 'Simeon', birthday: null },
      { name: 'Abijah', birthday: null },
    ],
  },
  {
    key: 'arihos',
    label: 'The Arihos',
    initial: 'A',
    color: '#10b981',
    birthOrder: 4,
    members: [
      { name: 'Solomon Ariho', role: '4th born / Farm supervisor', birthday: '14 Nov 1988', avatarKey: 'solomonariho', isHead: true },
    ],
    children: [
      { name: 'Caia', birthday: '11 Jun' },
    ],
  },
  {
    key: 'arindas',
    label: 'The Arindas',
    initial: 'A',
    color: '#3b82f6',
    birthOrder: 5,
    members: [
      { name: 'Hillary Arinda', role: '5th born / Secretary', birthday: '10 Oct 1990', avatarKey: 'hillaryarinda', isHead: true },
      { name: 'Esther Arinda', role: "Hillary's wife", birthday: '26 Jan 1993', avatarKey: 'estherarinda' },
    ],
    children: [
      { name: 'Ethan', birthday: '29 Oct 2021' },
      { name: 'Hansel', birthday: '18 Nov 2022' },
    ],
  },
  {
    key: 'kofunas',
    label: 'The Kofunas',
    initial: 'K',
    color: '#f97316',
    birthOrder: 6,
    members: [
      { name: 'Hellen Kofuna', role: '6th born / Treasurer', birthday: '2 Oct 1992', avatarKey: 'hellenkofuna', isHead: true },
      { name: 'Lawi Kofuna', role: "Hellen's husband", birthday: '16 Jul', avatarKey: 'lawikofuna' },
    ],
    children: [
      { name: 'Lael', birthday: '28 Oct 2022' },
      { name: 'Lainey', birthday: '6 Jan 2026' },
    ],
  },
]

// Map finance page family labels to tree keys
export const LABEL_TO_KEY: Record<string, string> = {
  'The Kikangis':   'kikangis',
  'The Tuhimbises': 'tuhimbises',
  'The Turamyes':   'turamyes',
  'The Arungas':    'arungas',
  'The Arihos':     'arihos',
  'The Arindas':    'arindas',
  'The Kofunas':    'kofunas',
}

/** Parse a full birthday string ("10 Oct 1990") to age in years, or null if year missing. */
export function parseAge(birthday: string | null): number | null {
  if (!birthday) return null
  const m = birthday.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (!m) return null
  const MON: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
  }
  const mon = MON[m[2].toLowerCase().slice(0, 3)]
  if (mon === undefined) return null
  const dob = new Date(parseInt(m[3]), mon, parseInt(m[1]))
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  if (today < new Date(today.getFullYear(), mon, parseInt(m[1]))) age--
  return age
}

/** Format birthday for display. "10 Oct 1990" → "10 Oct 1990", "26 Jan" → "26 Jan (no year)". */
export function formatBirthday(birthday: string | null): string {
  if (!birthday) return 'Birthday not recorded'
  const hasYear = /\d{4}/.test(birthday)
  return hasYear ? birthday : `${birthday} (year unknown)`
}
