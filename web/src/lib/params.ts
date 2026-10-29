import type { Device, ParamDef, Position } from '@/api/types'

/** Built-in names for parameters the server reports (normalized keys and common Teltonika IO ids). */
export interface CatalogEntry {
  name: string
  unit?: string
  /** formats the raw value; default: number / yes-no / text */
  format?: (v: unknown) => string
}

const yesNo = (v: unknown) => (v === true || v === 1 ? 'Yes' : v === false || v === 0 ? 'No' : String(v))
const onOff = (v: unknown) => (v === true || v === 1 ? 'On' : v === false || v === 0 ? 'Off' : String(v))
const km = (v: unknown) => (typeof v === 'number' ? `${(v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : String(v))

export const POSITION_FIELDS: Record<string, CatalogEntry> = {
  speed: { name: 'Speed', unit: 'km/h' },
  course: { name: 'Heading', unit: '°' },
  altitude: { name: 'Altitude', unit: 'm' },
  satellites: { name: 'Satellites' },
  lat: { name: 'Latitude' },
  lng: { name: 'Longitude' },
  valid: { name: 'GPS fix valid', format: yesNo },
  priority: { name: 'Record priority' },
  eventId: { name: 'Event IO id' },
}

export const CATALOG: Record<string, CatalogEntry> = {
  ignition: { name: 'Ignition', format: onOff },
  motion: { name: 'Movement', format: yesNo },
  power: { name: 'External voltage', unit: 'V' },
  battery: { name: 'Battery voltage', unit: 'V' },
  batteryLevel: { name: 'Battery level', unit: '%' },
  odometer: { name: 'Total odometer', format: km },
  tripOdometer: { name: 'Trip odometer', format: km },
  rssi: { name: 'GSM signal', unit: '/5' },
  gnssStatus: {
    name: 'GNSS status',
    format: (v) => ({ 0: 'Off', 1: 'On, fix', 2: 'On, no fix', 3: 'Sleep' })[Number(v)] ?? String(v),
  },
  hdop: { name: 'HDOP' },
  pdop: { name: 'PDOP' },
  fuel: { name: 'Fuel level (CAN)', unit: '%' },
  fuelUsed: { name: 'Fuel used (CAN)', unit: 'L' },
  rpm: { name: 'Engine RPM', unit: 'rpm' },
  engineTemp: { name: 'Engine temperature', unit: '°C' },
  driverId: { name: 'Driver iButton / RFID' },
  sleepMode: { name: 'Sleep mode', format: (v) => ({ 0: 'No sleep', 1: 'GPS sleep', 2: 'Deep sleep', 3: 'Online sleep', 4: 'Ultra sleep' })[Number(v)] ?? String(v) },
  in1: { name: 'Digital input 1', format: onOff },
  in2: { name: 'Digital input 2', format: onOff },
  in3: { name: 'Digital input 3', format: onOff },
  in4: { name: 'Digital input 4', format: onOff },
  out1: { name: 'Digital output 1', format: onOff },
  out2: { name: 'Digital output 2', format: onOff },
  out3: { name: 'Digital output 3', format: onOff },
  out4: { name: 'Digital output 4', format: onOff },
  alarm: { name: 'Alarm' },
  harsh: { name: 'Harsh driving' },
  harshValue: { name: 'Harsh driving force', unit: 'g' },
  originalDeviceTime: { name: 'Device clock (corrected)' },
  // Teltonika FMB IO elements that keep their io<ID> key
  io6: { name: 'Analog input 2', unit: 'mV' },
  io9: { name: 'Analog input 1', unit: 'mV' },
  io10: { name: 'SD card status' },
  io11: { name: 'SIM ICCID (part 1)' },
  io12: { name: 'Fuel used (GPS)', unit: 'L' },
  io13: { name: 'Fuel rate (GPS)', unit: 'L/100km' },
  io14: { name: 'SIM ICCID (part 2)' },
  io15: { name: 'Eco score' },
  io17: { name: 'Accelerometer X', unit: 'mG' },
  io18: { name: 'Accelerometer Y', unit: 'mG' },
  io19: { name: 'Accelerometer Z', unit: 'mG' },
  io24: { name: 'GNSS speed', unit: 'km/h' },
  io25: { name: 'BLE temperature 1', unit: '×0.01 °C' },
  io26: { name: 'BLE temperature 2', unit: '×0.01 °C' },
  io27: { name: 'BLE temperature 3', unit: '×0.01 °C' },
  io28: { name: 'BLE temperature 4', unit: '×0.01 °C' },
  io68: { name: 'Battery current', unit: 'mA' },
  io72: { name: 'Dallas temperature 1', unit: '×0.1 °C' },
  io73: { name: 'Dallas temperature 2', unit: '×0.1 °C' },
  io74: { name: 'Dallas temperature 3', unit: '×0.1 °C' },
  io75: { name: 'Dallas temperature 4', unit: '×0.1 °C' },
  io80: { name: 'Data mode', format: (v) => ({ 0: 'Home, stop', 1: 'Home, moving', 2: 'Roaming, stop', 3: 'Roaming, moving', 4: 'Unknown, stop', 5: 'Unknown, moving' })[Number(v)] ?? String(v) },
  io116: { name: 'Charger connected', format: yesNo },
  io205: { name: 'GSM cell id' },
  io206: { name: 'GSM area code' },
  io237: { name: 'Network type', format: (v) => ({ 0: '3G', 1: 'GSM', 2: '4G', 3: 'LTE Cat-M1', 4: 'NB-IoT', 99: 'Unknown' })[Number(v)] ?? String(v) },
  io238: { name: 'User id' },
  io241: { name: 'GSM operator code' },
  io250: { name: 'Trip', format: (v) => ({ 0: 'Trip stop', 1: 'Trip start', 2: 'Business', 3: 'Private' })[Number(v)] ?? String(v) },
  io251: { name: 'Idling', format: yesNo },
  io252: { name: 'Unplugged', format: yesNo },
  io253: { name: 'Green driving type' },
  io254: { name: 'Green driving value' },
  io255: { name: 'Over speeding', unit: 'km/h' },
  io263: { name: 'Bluetooth status' },
  io303: { name: 'Instant movement', format: yesNo },
  io449: { name: 'Ignition on counter', unit: 's' },
}

export interface ParamRow {
  key: string
  name: string
  /** where the name comes from */
  named: 'custom' | 'builtin' | 'none'
  value: unknown
  display: string
  unit: string
  source: 'field' | 'raw' | 'calculated'
  def?: ParamDef
  hidden: boolean
}

/** Definitions effective for a device: device-specific ones replace global ones with the same key. */
export function effectiveDefs(defs: ParamDef[], deviceId: number): Map<string, ParamDef> {
  const out = new Map<string, ParamDef>()
  for (const d of defs) if (d.deviceId == null) out.set(d.key, d)
  for (const d of defs) if (d.deviceId === deviceId) out.set(d.key, d)
  return out
}

export function formatValue(v: unknown, decimals?: number): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: decimals ?? 3 })
  return String(v)
}

function ioNumber(k: string) {
  const m = /^io(\d+)$/.exec(k)
  return m ? Number(m[1]) : null
}

/** Natural order: defined parameters by position, then built-ins, then io<N> numerically, then the rest. */
function compareKeys(a: ParamRow, b: ParamRow): number {
  const rank = (r: ParamRow) => (r.source === 'field' ? 0 : r.def ? 1 : r.named === 'builtin' && ioNumber(r.key) == null ? 2 : 3)
  const d = rank(a) - rank(b)
  if (d) return d
  if (a.source === 'field') return 0 // keep speed, heading, altitude… order
  if (a.def && b.def) return a.def.position - b.def.position || a.def.id - b.def.id
  const na = ioNumber(a.key)
  const nb = ioNumber(b.key)
  if (na != null && nb != null) return na - nb
  if (na != null) return 1
  if (nb != null) return -1
  return a.key.localeCompare(b.key)
}

/** Every parameter of a fix, named and formatted. */
export function paramRows(device: Device, position: Position | null, defs: ParamDef[]): ParamRow[] {
  const eff = effectiveDefs(defs, device.id)
  const rows: ParamRow[] = []
  const add = (key: string, value: unknown, source: ParamRow['source']) => {
    const def = eff.get(key)
    const cat = source === 'field' ? POSITION_FIELDS[key] : CATALOG[key]
    const name = def?.name || cat?.name || key
    const unit = def?.unit || (def ? '' : cat?.unit) || ''
    const display = def ? formatValue(value, def.decimals) : cat?.format ? cat.format(value) : formatValue(value)
    rows.push({
      key,
      name,
      named: def ? 'custom' : cat ? 'builtin' : 'none',
      value,
      display,
      unit: cat?.format && !def ? '' : unit,
      source: def?.kind === 'calculated' ? 'calculated' : source,
      def,
      hidden: !!def?.hidden,
    })
  }
  if (position) {
    add('speed', position.speed, 'field')
    add('course', position.course, 'field')
    add('altitude', position.altitude, 'field')
    add('satellites', position.satellites, 'field')
    add('lat', position.lat, 'field')
    add('lng', position.lng, 'field')
    add('valid', position.valid, 'field')
    for (const [k, v] of Object.entries(position.attributes ?? {})) add(k, v, 'raw')
  }
  // calculated parameters whose inputs were not in this fix
  for (const d of eff.values()) if (d.kind === 'calculated' && !rows.some((r) => r.key === d.key)) add(d.key, null, 'calculated')
  return rows.sort(compareKeys)
}

/** Name for a key on a device (for charts, messages, pickers). */
export function paramName(key: string, defs: ParamDef[], deviceId?: number): string {
  const d = deviceId != null ? effectiveDefs(defs, deviceId).get(key) : defs.find((x) => x.key === key && x.deviceId == null)
  return d?.name || CATALOG[key]?.name || POSITION_FIELDS[key]?.name || key
}

export const FORMULA_FUNCTIONS: Array<{ sig: string; help: string }> = [
  { sig: 'if(cond, a, b)', help: 'a when cond is true, else b' },
  { sig: 'round(x, d)', help: 'round to d decimals' },
  { sig: 'min(a, b, …) / max(…)', help: 'smallest / largest' },
  { sig: 'abs(x)  floor(x)  ceil(x)  sqrt(x)  pow(x, y)', help: 'maths' },
  { sig: 'between(x, lo, hi)', help: 'lo ≤ x ≤ hi' },
  { sig: 'bit(x, n)', help: 'bit n (0 = lowest) of x is set' },
  { sig: 'has(io9)', help: 'the fix carries this parameter' },
]
