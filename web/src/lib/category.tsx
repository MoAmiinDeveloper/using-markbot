import { deviceIconOf } from './deviceIcons'
import { Bike, Bus, Car, CarFront, CircleDot, Container, Truck, type LucideIcon } from 'lucide-react'

export const CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
  car: { label: 'Car', icon: Car },
  truck: { label: 'Truck', icon: Truck },
  van: { label: 'Van', icon: CarFront },
  bus: { label: 'Bus', icon: Bus },
  motorcycle: { label: 'Motorcycle', icon: Bike },
  trailer: { label: 'Trailer', icon: Container },
  other: { label: 'Other', icon: CircleDot },
}

export function categoryMeta(c: string) {
  return CATEGORY_META[c] ?? CATEGORY_META.other
}

/** Category icon, or the device's own map icon when given. */
export function CategoryIcon({ category, icon, className }: { category: string; icon?: string; className?: string }) {
  const Icon = deviceIconOf(icon) ?? categoryMeta(category).icon
  return <Icon className={className} aria-hidden />
}

/** The device's own map icon if set, else its category icon. */
export function DeviceGlyph({ device, className }: { device: { category: string; icon?: string }; className?: string }) {
  const Icon = deviceIconOf(device.icon) ?? categoryMeta(device.category).icon
  return <Icon className={className} aria-hidden />
}
