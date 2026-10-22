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

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = categoryMeta(category).icon
  return <Icon className={className} aria-hidden />
}
