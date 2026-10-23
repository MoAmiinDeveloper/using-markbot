import {
  Building2,
  CircleDollarSign,
  CircleDot,
  CircleParking,
  ClipboardCheck,
  Disc,
  FileBadge,
  Fuel,
  IdCard,
  Landmark,
  ReceiptText,
  ShieldCheck,
  Store,
  Ticket,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ExpenseCategory, PlaceCategory, ReminderKind } from '@/api/types'

interface Meta {
  label: string
  icon: LucideIcon
  color: string
}

export const EXPENSE_META: Record<ExpenseCategory, Meta> = {
  fuel: { label: 'Fuel', icon: Fuel, color: '#f97316' },
  maintenance: { label: 'Maintenance', icon: Wrench, color: '#14b8a6' },
  toll: { label: 'Toll / Salik', icon: Ticket, color: '#6366f1' },
  parking: { label: 'Parking', icon: CircleParking, color: '#0ea5e9' },
  fine: { label: 'Fine', icon: ReceiptText, color: '#f43f5e' },
  insurance: { label: 'Insurance', icon: ShieldCheck, color: '#8b5cf6' },
  tyres: { label: 'Tyres', icon: Disc, color: '#64748b' },
  other: { label: 'Other', icon: CircleDollarSign, color: '#a1a1aa' },
}
export const expenseMeta = (c: string) => EXPENSE_META[c as ExpenseCategory] ?? EXPENSE_META.other

export const REMINDER_META: Record<ReminderKind, Meta> = {
  insurance: { label: 'Insurance', icon: ShieldCheck, color: '#8b5cf6' },
  registration: { label: 'Registration', icon: FileBadge, color: '#0ea5e9' },
  license: { label: 'Licence', icon: IdCard, color: '#f59e0b' },
  permit: { label: 'Permit', icon: Landmark, color: '#14b8a6' },
  inspection: { label: 'Inspection', icon: ClipboardCheck, color: '#10b981' },
  other: { label: 'Other', icon: CircleDot, color: '#64748b' },
}
export const reminderMeta = (k: string) => REMINDER_META[k as ReminderKind] ?? REMINDER_META.other

export const PLACE_META: Record<PlaceCategory, Meta> = {
  depot: { label: 'Depot', icon: Warehouse, color: '#ffd700' },
  customer: { label: 'Customer', icon: Store, color: '#3b82f6' },
  fuel: { label: 'Fuel station', icon: Fuel, color: '#f97316' },
  parking: { label: 'Parking', icon: CircleParking, color: '#0ea5e9' },
  workshop: { label: 'Workshop', icon: Wrench, color: '#14b8a6' },
  other: { label: 'Other', icon: Building2, color: '#8b5cf6' },
}
export const placeMeta = (c: string) => PLACE_META[c as PlaceCategory] ?? PLACE_META.other
