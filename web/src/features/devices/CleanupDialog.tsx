import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type { Device } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SourceBadge } from '@/components/ui/SourceBadge'
import { useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

/** IMEIs used by the bundled simulator (base 356307040000000 + i) and phone tracker. */
export function isTestDevice(d: Device): boolean {
  if (d.imei === '350000000000001') return true
  if (!/^\d{15}$/.test(d.imei)) return false
  const n = Number(d.imei)
  return n >= 356307040000000 && n <= 356307040009999
}

/** Pick devices to delete together with all their data; test devices are pre-selected. */
export function CleanupDialog({ devices, onClose }: { devices: Device[]; onClose: () => void }) {
  const remove = useLive((s) => s.remove)
  const sorted = useMemo(() => [...devices].sort((a, b) => Number(isTestDevice(b)) - Number(isTestDevice(a)) || a.name.localeCompare(b.name, undefined, { numeric: true })), [devices])
  const [sel, setSel] = useState<Set<number>>(() => new Set(devices.filter(isTestDevice).map((d) => d.id)))
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [confirm, setConfirm] = useState('')
  const toggle = (id: number) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s).add(id)))
  const n = sel.size

  const run = async () => {
    const ids = [...sel]
    setBusy({ done: 0, total: ids.length })
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.deleteDevice(ids[i])
        remove(ids[i])
      } catch {
        failed++
      }
      setBusy({ done: i + 1, total: ids.length })
    }
    if (failed) toast.error(`${failed} device${failed === 1 ? '' : 's'} could not be deleted`)
    else toast.success(`${ids.length} device${ids.length === 1 ? '' : 's'} deleted`, 'History, alerts and trips removed too')
    onClose()
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title="Clean up devices"
      footer={
        <>
          <Button onClick={onClose} disabled={!!busy} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} disabled={!n || confirm.trim().toUpperCase() !== 'DELETE'} loading={!!busy} onClick={() => void run()}>
            {busy ? `Deleting ${busy.done}/${busy.total}…` : `Delete ${n} device${n === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="text-slate-600 dark:text-slate-300">
          Deletes the selected devices <b>with all their data</b> — positions, trips, alerts, sensors and parameters. Test devices from the simulator and phone tracker are already
          selected. This cannot be undone.
        </p>
        <div className="max-h-[300px] overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10">
          {sorted.map((d) => {
            const test = isTestDevice(d)
            return (
              <label key={d.id} className={cn('flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-white/[0.05]', sel.has(d.id) && 'bg-rose-500/[0.06]')}>
                <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} className="h-4 w-4 accent-rose-600" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-900 dark:text-white">{d.name}</span>
                    {test && <span className="rounded bg-amber-500/15 px-1.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">TEST</span>}
                    {d.source === 'traccar' && <SourceBadge source={d.source} />}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-slate-500">
                    {d.imei} · last data {timeAgo(d.lastSeen)}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        <label className="block">
          <span className="text-[12px] text-slate-500 dark:text-slate-400">
            Type <b>DELETE</b> to confirm
          </span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-[13px] uppercase focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30 dark:border-white/10 dark:bg-white/[0.04]"
            autoComplete="off"
          />
        </label>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">Tip: stop the simulator (don’t start with <code>-Demo</code>), or the test devices register again.</p>
      </div>
    </Modal>
  )
}
