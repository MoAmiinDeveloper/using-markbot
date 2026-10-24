import { Activity, Droplets, Fuel, Thermometer, Zap, type LucideIcon } from 'lucide-react'
import type { Sensor, SensorType } from '@/api/types'

export const SENSOR_META: Record<SensorType, { label: string; icon: LucideIcon; color: string; unit: string; decimals: number }> = {
  fuel: { label: 'Fuel', icon: Fuel, color: '#f97316', unit: 'L', decimals: 1 },
  temperature: { label: 'Temperature', icon: Thermometer, color: '#0ea5e9', unit: '°C', decimals: 1 },
  humidity: { label: 'Humidity', icon: Droplets, color: '#14b8a6', unit: '%', decimals: 0 },
  voltage: { label: 'Voltage', icon: Zap, color: '#eab308', unit: 'V', decimals: 2 },
  generic: { label: 'Generic', icon: Activity, color: '#8b5cf6', unit: '', decimals: 1 },
}
export const sensorMeta = (t: string) => SENSOR_META[t as SensorType] ?? SENSOR_META.generic

/** Teltonika IO hints (docs/API.md). */
export interface SourceHint {
  key: string
  label: string
  type: SensorType
  multiplier?: number
  unit?: string
}
export const TELTONIKA_HINTS: SourceHint[] = [
  { key: 'io9', label: 'AIN1 analog input (mV)', type: 'voltage', multiplier: 0.001, unit: 'V' },
  { key: 'io201', label: 'LLS 1 fuel level', type: 'fuel', unit: 'L' },
  { key: 'io203', label: 'LLS 2 fuel level', type: 'fuel', unit: 'L' },
  { key: 'io72', label: 'Dallas temperature 1 (×0.1 °C)', type: 'temperature', multiplier: 0.1, unit: '°C' },
  { key: 'io73', label: 'Dallas temperature 2 (×0.1 °C)', type: 'temperature', multiplier: 0.1, unit: '°C' },
  { key: 'io74', label: 'Dallas temperature 3 (×0.1 °C)', type: 'temperature', multiplier: 0.1, unit: '°C' },
  { key: 'io75', label: 'Dallas temperature 4 (×0.1 °C)', type: 'temperature', multiplier: 0.1, unit: '°C' },
  { key: 'io25', label: 'BLE temperature 1 (×0.01 °C)', type: 'temperature', multiplier: 0.01, unit: '°C' },
  { key: 'io26', label: 'BLE temperature 2 (×0.01 °C)', type: 'temperature', multiplier: 0.01, unit: '°C' },
  { key: 'io27', label: 'BLE temperature 3 (×0.01 °C)', type: 'temperature', multiplier: 0.01, unit: '°C' },
  { key: 'io28', label: 'BLE temperature 4 (×0.01 °C)', type: 'temperature', multiplier: 0.01, unit: '°C' },
  { key: 'power', label: 'External power (V)', type: 'voltage', unit: 'V' },
  { key: 'battery', label: 'Internal battery (V)', type: 'voltage', unit: 'V' },
  { key: 'fuel', label: 'Fuel (as reported)', type: 'fuel' },
]
export const hintFor = (key: string) => TELTONIKA_HINTS.find((h) => h.key === key)

/** Linear interpolation over the calibration table (clamped), else raw × multiplier + offset. */
export function computeValue(s: Pick<Sensor, 'calibration' | 'multiplier' | 'offset'>, raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const pts = [...(s.calibration ?? [])].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0])
  if (pts.length >= 2) {
    if (raw <= pts[0][0]) return pts[0][1]
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      if (raw <= x1) return x1 === x0 ? y1 : y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0)
    }
    return pts[pts.length - 1][1]
  }
  return raw * (s.multiplier ?? 1) + (s.offset ?? 0)
}

export function fmtSensor(v: number | null | undefined, unit: string, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
  return unit ? `${n} ${unit}` : n
}
