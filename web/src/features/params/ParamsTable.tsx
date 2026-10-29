import { useMemo, useState } from 'react'
import { Calculator, Eye, EyeOff, Pencil, Search, Tag } from 'lucide-react'
import type { Device, ParamDef } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { useParamDefs } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { paramRows, type ParamRow } from '@/lib/params'
import { timeAgo } from '@/lib/format'
import { useNow } from '@/store/now'
import { cn } from '@/lib/cn'
import { ParamForm, type ParamDraft } from './ParamForm'

const SOURCE_LABEL: Record<ParamRow['source'], string> = { field: 'GPS', raw: 'Device', calculated: 'Calculated' }

/** Every parameter of the device's latest record, with names, units and live values. */
export function ParamsTable({ device, compact }: { device: Device; compact?: boolean }) {
  useNow() // re-render "x ago"
  const defsQ = useParamDefs()
  const defs = useMemo(() => defsQ.data ?? [], [defsQ.data])
  const { canManageDevice } = useAccess()
  const canEdit = canManageDevice(device)
  const [q, setQ] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [editing, setEditing] = useState<{ initial: ParamDef | null; draft?: ParamDraft } | null>(null)

  const rows = useMemo(() => paramRows(device, device.position, defs), [device, defs])
  const hiddenCount = rows.filter((r) => r.hidden).length
  const s = q.trim().toLowerCase()
  const shown = rows.filter((r) => (showHidden || !r.hidden) && (!s || r.key.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.display.toLowerCase().includes(s)))

  const rename = (r: ParamRow) =>
    setEditing(
      r.def
        ? { initial: r.def }
        : { initial: null, draft: { kind: 'mapped', key: r.key, deviceId: null, name: r.named === 'builtin' ? r.name : '', unit: r.unit } },
    )

  if (defsQ.isLoading) return <Skeleton className="h-40 rounded-xl" />
  if (!device.position)
    return <EmptyState icon={<Tag className="h-5 w-5" />} title="No data yet" description="Parameters appear here as soon as the tracker sends its first record." />

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input aria-label="Filter parameters" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter parameters…" icon={<Search className="h-3.5 w-3.5" />} className="h-8 text-[12.5px]" />
        {hiddenCount > 0 && (
          <IconButton size="sm" label={showHidden ? 'Hide hidden parameters' : `Show ${hiddenCount} hidden`} onClick={() => setShowHidden((x) => !x)}>
            {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </IconButton>
        )}
        {canEdit && !compact && (
          <Button size="sm" icon={<Calculator className="h-3.5 w-3.5" />} onClick={() => setEditing({ initial: null, draft: { kind: 'calculated', deviceId: device.id } })}>
            Calculated
          </Button>
        )}
      </div>
      <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
        {rows.length} parameters · record from {timeAgo(device.position.time)}
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/[0.07]">
        <table className="w-full text-[12.5px]">
          <thead className="bg-navy-50/80 text-navy-700/80 text-[11px] uppercase tracking-wide dark:bg-white/[0.03] dark:text-slate-400">
            <tr>
              <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                Parameter
              </th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
                Value
              </th>
              {!compact && (
                <th scope="col" className="hidden px-2.5 py-1.5 text-left font-medium sm:table-cell">
                  Source
                </th>
              )}
              {canEdit && <th scope="col" className="w-8" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {shown.map((r) => (
              <tr key={r.key} className={cn('group', r.hidden && 'opacity-50')}>
                <td className="max-w-0 px-2.5 py-1.5">
                  <div className={cn('truncate', r.named === 'none' ? 'font-mono text-slate-600 dark:text-slate-300' : 'font-medium text-slate-900 dark:text-white')}>{r.name}</div>
                  {r.named !== 'none' && <div className="truncate font-mono text-[10.5px] text-slate-400">{r.key}</div>}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                  <span className={cn('tabular font-medium', r.value == null ? 'text-slate-400' : 'text-slate-900 dark:text-white')} title={r.def?.expression || undefined}>
                    {r.value == null && r.source === 'calculated' ? 'no input' : r.display}
                  </span>
                  {r.unit && r.value != null && <span className="ml-1 text-slate-400">{r.unit}</span>}
                </td>
                {!compact && (
                  <td className="hidden px-2.5 py-1.5 sm:table-cell">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10.5px] font-medium',
                        r.source === 'calculated' ? 'bg-brand-500/15 text-brand-800 dark:text-brand-200' : r.source === 'field' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
                      )}
                    >
                      {SOURCE_LABEL[r.source]}
                      {r.def?.deviceId != null && ' · this vehicle'}
                    </span>
                  </td>
                )}
                {canEdit && (
                  <td className="px-1 py-1">
                    {r.source !== 'field' && (
                      <IconButton size="sm" label={r.def ? `Edit ${r.name}` : `Rename ${r.key}`} onClick={() => rename(r)} className="sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-3 py-4 text-center text-[12.5px] text-slate-500">No parameter matches “{q}”.</p>}
      </div>
      {editing && <ParamForm initial={editing.initial} draft={editing.draft} defs={defs} onClose={() => setEditing(null)} />}
    </div>
  )
}
