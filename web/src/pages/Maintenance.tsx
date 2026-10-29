import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileClock, Receipt, Wrench } from 'lucide-react'
import { api, qk } from '@/api/client'
import { Tabs } from '@/components/ui/Tabs'
import { SchedulesTab } from '@/features/maintenance/Schedules'
import { RemindersTab } from '@/features/maintenance/Reminders'
import { ExpensesTab } from '@/features/maintenance/Expenses'
import { useDeviceList } from '@/store/live'
import { Select } from '@/components/ui/Input'

type Tab = 'schedules' | 'reminders' | 'expenses'

export default function MaintenancePage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'reminders' ? 'reminders' : params.get('tab') === 'expenses' ? 'expenses' : 'schedules'
  const device = params.get('device') ? Number(params.get('device')) : null
  const devices = useDeviceList()
  // shared with the tabs (same query keys), used for the tab badges
  const maint = useQuery({ queryKey: qk.maintenance, queryFn: () => api.maintenance(), meta: { silent: true } })
  const rem = useQuery({ queryKey: qk.reminders, queryFn: () => api.reminders(), meta: { silent: true } })
  const overdueM = (maint.data ?? []).filter((m) => m.status !== 'ok').length
  const overdueR = (rem.data ?? []).filter((r) => r.status !== 'ok').length

  const setQ = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v == null ? next.delete(k) : next.set(k, v)
    setParams(next, { replace: true })
  }
  const setDevice = (id: number | null) => setQ({ device: id == null ? null : String(id) })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Maintenance</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">Service schedules, document renewals and running costs</p>
          </div>
          {tab !== 'schedules' && (
            <Select aria-label="Vehicle" value={device ?? ''} onChange={(e) => setDevice(e.target.value ? Number(e.target.value) : null)} className="w-full sm:w-60">
              <option value="">All vehicles</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <Tabs<Tab>
          value={tab}
          onChange={(t) => setQ({ tab: t })}
          tabs={[
            { id: 'schedules', label: 'Schedules', icon: <Wrench />, count: overdueM || undefined, alert: (maint.data ?? []).some((m) => m.status === 'overdue') },
            { id: 'reminders', label: 'Documents', icon: <FileClock />, count: overdueR || undefined, alert: (rem.data ?? []).some((r) => r.status === 'overdue') },
            { id: 'expenses', label: 'Expenses', icon: <Receipt /> },
          ]}
        />
        {tab === 'schedules' && <SchedulesTab deviceFilter={device} setDeviceFilter={setDevice} />}
        {tab === 'reminders' && <RemindersTab deviceFilter={device} />}
        {tab === 'expenses' && <ExpensesTab deviceFilter={device} />}
      </div>
    </div>
  )
}
