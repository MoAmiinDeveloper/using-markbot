import { endOfDay, format, startOfDay, startOfMonth, startOfWeek, subDays } from 'date-fns'

export type PeriodPreset = 'today' | 'yesterday' | 'week' | '7d' | 'month' | 'custom'

export const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string; short: string }> = [
  { id: 'today', label: 'Today', short: 'Today' },
  { id: 'yesterday', label: 'Yesterday', short: 'Yesterday' },
  { id: 'week', label: 'This week', short: 'Week' },
  { id: '7d', label: 'Last 7 days', short: '7 days' },
  { id: 'month', label: 'This month', short: 'Month' },
  { id: 'custom', label: 'Custom', short: 'Custom' },
]

/** Reports may span at most 93 days (server limit). */
export const MAX_RANGE_DAYS = 93

export function presetRange(p: Exclude<PeriodPreset, 'custom'>, now = new Date()): [Date, Date] {
  switch (p) {
    case 'today':
      return [startOfDay(now), now]
    case 'yesterday': {
      const y = subDays(now, 1)
      return [startOfDay(y), endOfDay(y)]
    }
    case 'week':
      return [startOfWeek(now, { weekStartsOn: 1 }), now]
    case '7d':
      return [startOfDay(subDays(now, 6)), now]
    case 'month':
      return [startOfMonth(now), now]
  }
}

export const toLocalInput = (d: Date | number) => format(d, "yyyy-MM-dd'T'HH:mm")

/** Human label for a period: "22 Oct 2026, 00:00 – 14:05" or "1 Oct – 22 Oct 2026". */
export function fmtPeriod(from: string, to: string): string {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return ''
  const sameDay = a.toDateString() === b.toDateString()
  if (sameDay) return `${format(a, 'd MMM yyyy')}, ${format(a, 'HH:mm')} – ${format(b, 'HH:mm')}`
  const sameYear = a.getFullYear() === b.getFullYear()
  return `${format(a, sameYear ? 'd MMM, HH:mm' : 'd MMM yyyy, HH:mm')} – ${format(b, 'd MMM yyyy, HH:mm')}`
}
