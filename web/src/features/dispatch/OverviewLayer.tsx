import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Job } from '@/api/types'
import { useMapCtx } from '@/components/map/MapCanvas'
import { isTerminal, jobStatusMeta, lateBy } from './meta'

/** Overview: one pill per open job at its next stop, coloured by job status (red ring when late). */
export function JobsOverviewLayer({ jobs, now, onSelect }: { jobs: Job[]; now: number; onSelect: (id: number) => void }) {
  const { map } = useMapCtx()
  const cb = useRef(onSelect)
  cb.current = onSelect
  const open = jobs.filter((j) => !isTerminal(j.status) && j.stops.length)
  const key = open.map((j) => `${j.id}:${j.status}:${j.stops.map((s) => s.status).join('')}:${lateBy(j, now) != null}`).join(',')
  useEffect(() => {
    if (!map) return
    const ms = open.map((j) => {
      const s = j.stops.find((x) => x.status === 'pending' || x.status === 'arrived') ?? j.stops[j.stops.length - 1]
      const m = jobStatusMeta(j.status)
      const el = document.createElement('div')
      el.className = 'place-pin'
      el.style.setProperty('--pin', m.color)
      el.style.setProperty('--pin-fg', j.status === 'inProgress' ? '#141b37' : '#ffffff')
      if (lateBy(j, now) != null) el.style.boxShadow = '0 0 0 2px #f43f5e'
      const dot = document.createElement('span')
      dot.className = 'place-pin__dot'
      dot.textContent = String(j.stops.indexOf(s) + 1)
      const txt = document.createElement('span')
      txt.className = 'place-pin__txt'
      txt.textContent = j.reference.replace(/^JOB-0*/, '#')
      el.append(dot, txt)
      el.title = `${j.reference} · ${j.title}\nNext: ${s.name}`
      el.style.cursor = 'pointer'
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        cb.current(j.id)
      })
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-11, 0] }).setLngLat([s.lng, s.lat]).addTo(map)
    })
    return () => ms.forEach((m) => m.remove())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}
