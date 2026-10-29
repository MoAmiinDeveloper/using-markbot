import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calculator, Pencil, Plus, Sparkles, Table2, Tag, Trash2 } from 'lucide-react'
import { api, qk } from '@/api/client'
import type { ParamDef, ParamKind } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { Tabs } from '@/components/ui/Tabs'
import { useCustomEvents, useParamDefs } from '@/features/common/queries'
import { ParamForm } from '@/features/params/ParamForm'
import { ParamsTable } from '@/features/params/ParamsTable'
import { CustomEventsTab } from '@/features/params/CustomEvents'
import { useAccess } from '@/lib/access'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'

type Tab = 'live' | 'names' | 'calculated' | 'events'

function DefsList({ kind, defs, loading }: { kind: ParamKind; defs: ParamDef[]; loading: boolean }) {
  const qc = useQueryClient()
  const { isAdmin, canManage, canManageDevice } = useAccess()
  const byId = useLive((s) => s.byId)
  const [editing, setEditing] = useState<ParamDef | null | 'new'>(null)
  const [deleting, setDeleting] = useState<ParamDef | null>(null)
  const list = defs.filter((d) => d.kind === kind)
  const calc = kind === 'calculated'
  const canEdit = (d: ParamDef) => (d.deviceId == null ? isAdmin : canManageDevice(byId[d.deviceId]))
  const del = useMutation({
    mutationFn: (d: ParamDef) => api.deleteParam(d.id),
    onSuccess: (_, d) => {
      qc.setQueryData<ParamDef[]>(qk.params, (l) => l?.filter((x) => x.id !== d.id))
      toast.success('Parameter deleted', d.name)
      setDeleting(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          {calc
            ? 'Formulas computed on every incoming record and stored with it — usable in history, sensors, reports and custom events.'
            : 'Readable names and units for raw tracker parameters (io9 → “Fuel sensor”). Shown everywhere parameters appear.'}
        </p>
        {canManage && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="sm:ml-auto">
            {calc ? 'New calculated parameter' : 'Name a parameter'}
          </Button>
        )}
      </div>
      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={calc ? <Calculator className="h-5 w-5" /> : <Tag className="h-5 w-5" />}
            title={calc ? 'No calculated parameters' : 'No custom names yet'}
            description={calc ? 'E.g. fuel litres from an analog input: io9 / 1000 * 12.5' : 'Built-in names are used until you set your own. Tip: rename straight from the live table.'}
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {list.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="truncate font-medium text-slate-900 dark:text-white">{d.name}</span>
                    <code className="rounded bg-slate-500/10 px-1 text-[11px] text-slate-600 dark:text-slate-300">{d.key}</code>
                    {d.unit && <span className="text-[11.5px] text-slate-400">{d.unit}</span>}
                    {d.hidden && <span className="text-[11px] text-slate-400">hidden</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                    {d.deviceId == null ? 'All vehicles' : (byId[d.deviceId]?.name ?? `Vehicle #${d.deviceId}`)}
                    {calc && (
                      <>
                        {' · '}
                        <span className="font-mono text-slate-700 dark:text-slate-200">{d.expression}</span>
                      </>
                    )}
                  </div>
                </div>
                {canEdit(d) && (
                  <div className="flex shrink-0 gap-0.5 sm:opacity-60 sm:group-hover:opacity-100">
                    <IconButton size="sm" label={`Edit ${d.name}`} onClick={() => setEditing(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton size="sm" label={`Delete ${d.name}`} onClick={() => setDeleting(d)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <ParamForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} draft={{ kind }} defs={defs} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete “${deleting?.name ?? 'parameter'}”?`}
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600 dark:text-slate-300">
          {deleting?.kind === 'calculated' ? 'New records stop getting this value; records already stored keep it.' : 'The built-in name (or the raw key) is shown again.'}
        </p>
      </Modal>
    </div>
  )
}

export default function ParametersPage() {
  const [params, setParams] = useSearchParams()
  const t = params.get('tab')
  const tab: Tab = t === 'names' || t === 'calculated' || t === 'events' ? t : 'live'
  const defsQ = useParamDefs()
  const defs = useMemo(() => defsQ.data ?? [], [defsQ.data])
  const ce = useCustomEvents()
  const devices = useDeviceList()
  const deviceParam = Number(params.get('device')) || null
  const device = devices.find((d) => d.id === deviceParam) ?? devices.find((d) => d.position) ?? devices[0]
  const setQ = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v == null ? next.delete(k) : next.set(k, v)
    setParams(next, { replace: true })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Data parameters</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Everything your trackers report — named, calculated and turned into alerts</p>
        </div>
        <Tabs<Tab>
          value={tab}
          onChange={(x) => setQ({ tab: x === 'live' ? null : x })}
          tabs={[
            { id: 'live', label: 'Live table', icon: <Table2 /> },
            { id: 'names', label: 'Names', icon: <Tag />, count: defs.filter((d) => d.kind === 'mapped').length || undefined },
            { id: 'calculated', label: 'Calculated', icon: <Calculator />, count: defs.filter((d) => d.kind === 'calculated').length || undefined },
            { id: 'events', label: 'Custom events', icon: <Sparkles />, count: ce.data?.length || undefined },
          ]}
        />
        {tab === 'live' &&
          (device ? (
            <div className="space-y-3">
              <Select aria-label="Vehicle" value={device.id} onChange={(e) => setQ({ device: e.target.value })} className="w-full sm:w-72">
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.plate ? ` · ${d.plate}` : ''}
                    {d.position ? '' : ' (no data yet)'}
                  </option>
                ))}
              </Select>
              <div className="card p-3">
                <ParamsTable device={device} />
              </div>
            </div>
          ) : (
            <div className="card">
              <EmptyState icon={<Table2 className="h-5 w-5" />} title="No vehicles yet" description="Add a device on the Devices page first." />
            </div>
          ))}
        {(tab === 'names' || tab === 'calculated') && <DefsList kind={tab === 'names' ? 'mapped' : 'calculated'} defs={defs} loading={defsQ.isLoading} />}
        {tab === 'events' && <CustomEventsTab defs={defs} />}
      </div>
    </div>
  )
}
