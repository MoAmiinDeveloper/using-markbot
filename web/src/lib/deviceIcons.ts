import {
  Ambulance,
  Bike,
  Bus,
  BusFront,
  Car,
  CarFront,
  CarTaxiFront,
  Caravan,
  Construction,
  Container,
  Forklift,
  Fuel,
  Package,
  PersonStanding,
  Ship,
  Tractor,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { __iconNode as carNode } from 'lucide-react/dist/esm/icons/car.js'
import { __iconNode as taxiNode } from 'lucide-react/dist/esm/icons/car-taxi-front.js'
import { __iconNode as vanNode } from 'lucide-react/dist/esm/icons/bus-front.js'
import { __iconNode as pickupNode } from 'lucide-react/dist/esm/icons/car-front.js'
import { __iconNode as truckNode } from 'lucide-react/dist/esm/icons/truck.js'
import { __iconNode as tankerNode } from 'lucide-react/dist/esm/icons/fuel.js'
import { __iconNode as busNode } from 'lucide-react/dist/esm/icons/bus.js'
import { __iconNode as motorcycleNode } from 'lucide-react/dist/esm/icons/bike.js'
import { __iconNode as tractorNode } from 'lucide-react/dist/esm/icons/tractor.js'
import { __iconNode as ambulanceNode } from 'lucide-react/dist/esm/icons/ambulance.js'
import { __iconNode as forkliftNode } from 'lucide-react/dist/esm/icons/forklift.js'
import { __iconNode as excavatorNode } from 'lucide-react/dist/esm/icons/construction.js'
import { __iconNode as trailerNode } from 'lucide-react/dist/esm/icons/container.js'
import { __iconNode as caravanNode } from 'lucide-react/dist/esm/icons/caravan.js'
import { __iconNode as boatNode } from 'lucide-react/dist/esm/icons/ship.js'
import { __iconNode as personNode } from 'lucide-react/dist/esm/icons/person-standing.js'
import { __iconNode as assetNode } from 'lucide-react/dist/esm/icons/package.js'
import type { DeviceIcon } from '@/api/types'

export type IconNode = Array<[string, Record<string, string>]>

/** Map icons a device can use (the marker shows the glyph; the ring keeps the status colour). */
export const DEVICE_ICON_META: Record<DeviceIcon, { label: string; icon: LucideIcon; node: IconNode }> = {
  car: { label: 'Car', icon: Car, node: carNode },
  taxi: { label: 'Taxi', icon: CarTaxiFront, node: taxiNode },
  van: { label: 'Van', icon: BusFront, node: vanNode },
  pickup: { label: 'Pickup', icon: CarFront, node: pickupNode },
  truck: { label: 'Truck', icon: Truck, node: truckNode },
  tanker: { label: 'Tanker', icon: Fuel, node: tankerNode },
  bus: { label: 'Bus', icon: Bus, node: busNode },
  motorcycle: { label: 'Motorcycle', icon: Bike, node: motorcycleNode },
  tractor: { label: 'Tractor', icon: Tractor, node: tractorNode },
  ambulance: { label: 'Ambulance', icon: Ambulance, node: ambulanceNode },
  forklift: { label: 'Forklift', icon: Forklift, node: forkliftNode },
  excavator: { label: 'Machinery', icon: Construction, node: excavatorNode },
  trailer: { label: 'Trailer', icon: Container, node: trailerNode },
  caravan: { label: 'Caravan', icon: Caravan, node: caravanNode },
  boat: { label: 'Boat', icon: Ship, node: boatNode },
  person: { label: 'Person', icon: PersonStanding, node: personNode },
  asset: { label: 'Asset', icon: Package, node: assetNode },
}

/** The device's own icon, if it has one. */
export function deviceIconOf(icon: string | undefined): LucideIcon | null {
  return icon && icon in DEVICE_ICON_META ? DEVICE_ICON_META[icon as DeviceIcon].icon : null
}
