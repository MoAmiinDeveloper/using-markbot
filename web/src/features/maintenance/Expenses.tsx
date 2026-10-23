import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from 'date-fns'
import { Pencil, Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type ExpenseInput, type ExpenseQuery } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { useCurrency, useDrivers } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { EXPENSE_META, expenseMeta } from '@/lib/ops'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { fmtDate, fmtKm, fmtMoney, todayISO } from '@/lib/format'
import { cn } from '@/lib/cn'

type Period = 'month' | 'last' | '90d' | 'year'
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'month', label: 'This month' },
  { id: 'last', label: 'Last month' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
]
function periodRange(p: Period): [string, string] {
  const now = new Date()
  const d = (x: Date) => format(x, 'yyyy-MM-dd')
  switch (p) {
    case 'month':
      return [d(startOfMonth(now)), d(now)]
    case 'last': {
      const l = subMonths(now, 1)
      return [d(startOfMonth(l)), d(endOfMonth(l))]
    }
    case '90d':
      return [d(subDays(now, 90)), d(now)]
    case 'year':
      return [d(startOfYear(now)), d(now)]
  }
}

function CategoryIconChip({ c, size = 'md' }: { c: string; size?: 'sm' | 'md' }) {
  const m = expenseMeta(c)
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-lg', size === 'sm' ? 'h-7 w-7' : 'h-9 w-9 rounded-xl')}
      style={{ background: `${m.color}1f`, color: m.color }}
      title={m.label}
    >
      <m.icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </span>
  )
}

type FormV = { deviceId: string; driverId: string; category: ExpenseCategory; amount: string; liters: string; odometer: string; date: string; notes: string }

function ExpenseForm({ initial, defaultDevice, onClose }: { initial: Expense | null; defaultDevice?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const currency = useCurrency()
  const { canManageDevice } = useAccess()
  const devices = useDeviceList().filter((d) => canManageDevice(d))
  const drivers = useDrivers()
  const [v, setV] = useState<FormV>(() => ({
    deviceId: initial ? String(initial.deviceId) : defaultDevice ? String(defaultDevice) : '',
    driverId: initial?.driverId != null ? String(initial.driverId) : '',
    category: initial?.category ?? 'fuel',
    amount: initial ? String(initial.amount) : '',
    liters: initial?.liters != null ? String(initial.liters) : '',
    odometer: initial?.odometer != null ? String(Math.round(initial.odometer)) : '',
    date: initial?.date ?? todayISO(),
    notes: initial?.notes ?? '',
  }))
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof FormV>(k: K, val: FormV[K]) => setV((s) => ({ ...s, [k]: val }))
  const errors: Partial<Record<keyof FormV, string>> = {}
  if (!v.deviceId) errors.deviceId = 'Choose a vehicle'
  if (!(Number(v.amount) > 0)) errors.amount = 'Enter the amount'
  if (!v.date) errors.date = 'Pick a date'
  const show = (k: keyof FormV) => (touched ? errors[k] : undefined)
  const perLiter = v.category === 'fuel' && Number(v.amount) > 0 && Number(v.liters) > 0 ? Number(v.amount) / Number(v.liters) : null

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const input: ExpenseInput = {
        deviceId: Number(v.deviceId),
        driverId: v.driverId ? Number(v.driverId) : null,
        category: v.category,
        amount: Number(v.amount),
        liters: v.category === 'fuel' && v.liters ? Number(v.liters) : null,
        odometer: v.odometer ? Number(v.odometer) : null,
        date: v.date,
        notes: v.notes.trim(),
      }
      return initial ? api.updateExpense(initial.id, input) : api.createExpense(input)
    },
    onSuccess: (x) => {
      void qc.invalidateQueries({ queryKey: qk.expenses() })
      toast.success(initial ? 'Expense saved' : 'Expense added', `${expenseMeta(x.category).label} · ${fmtMoney(x.amount, currency)}`)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the expense'),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (Object.keys(errors).length) return
    save.mutate()
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? 'Edit expense' : 'Add expense'}
      subtitle={`Amounts in ${currency}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="expense-form" loading={save.isPending}>
            {initial ? 'Save changes' : 'Add expense'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Category</span>
          <div role="radiogroup" aria-label="Category" className="grid grid-cols-4 gap-1.5">
            {EXPENSE_CATEGORIES.map((c) => {
              const m = EXPENSE_META[c]
              const on = v.category === c
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set('category', c)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition-colors',
                    on
                      ? 'border-brand-500 bg-brand-500/10 text-navy-800 dark:text-brand-100'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20',
                  )}
                >
                  <m.icon className="h-4 w-4" style={{ color: m.color }} />
                  <span className="truncate">{m.label}</span>
                </button>
              )
            })}
          </div>
        </div>
        <Field label="Vehicle" required error={show('deviceId')}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={v.deviceId} invalid={!!show('deviceId')} onChange={(e) => set('deviceId', e.target.value)}>
              <option value="">Select a vehicle…</option>
              {devices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.plate ? ` · ${x.plate}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" required error={show('amount')}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="decimal"
                data-autofocus
                value={v.amount}
                invalid={!!show('amount')}
                placeholder="0.00"
                onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))}
                trailing={<span className="pr-1.5 text-[11px] text-slate-400">{currency}</span>}
              />
            )}
          </Field>
          <Field label="Date" required error={show('date')}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" value={v.date} max={todayISO()} onChange={(e) => set('date', e.target.value)} className="dark:[&_input]:[color-scheme:dark]" />}
          </Field>
          {v.category === 'fuel' && (
            <Field label="Litres" hint={perLiter ? `${fmtMoney(perLiter, currency)} per litre` : undefined}>
              {(id, d) => (
                <Input id={id} aria-describedby={d} inputMode="decimal" value={v.liters} placeholder="0" onChange={(e) => set('liters', e.target.value.replace(/[^\d.]/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">L</span>} />
              )}
            </Field>
          )}
          <Field label="Odometer">
            {(id) => <Input id={id} inputMode="numeric" value={v.odometer} placeholder="—" onChange={(e) => set('odometer', e.target.value.replace(/\D/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">km</span>} />}
          </Field>
        </div>
        <Field label="Driver">
          {(id) => (
            <Select id={id} value={v.driverId} onChange={(e) => set('driverId', e.target.value)}>
              <option value="">— None —</option>
              {drivers.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Notes">
          {(id) => <Textarea id={id} rows={2} value={v.notes} placeholder="Station, receipt number…" onChange={(e) => set('notes', e.target.value)} />}
        </Field>
      </form>
    </Drawer>
  )
}

export function ExpensesTab({ deviceFilter }: { deviceFilter: number | null }) {
  const qc = useQueryClient()
  const currency = useCurrency()
  const { canManage, canManageDevice } = useAccess()
  const byId = useLive((s) => s.byId)
  const [period, setPeriod] = useState<Period>('month')
  const [category, setCategory] = useState<ExpenseCategory | ''>('')
  const [editing, setEditing] = useState<Expense | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [from, to] = periodRange(period)
  const query: ExpenseQuery = { deviceId: deviceFilter ?? undefined, from, to }
  const q = useQuery({ queryKey: qk.expenses(query), queryFn: () => api.expenses(query) })
  const all = useMemo(() => q.data ?? [], [q.data])
  const rows = useMemo(() => all.filter((x) => !category || x.category === category).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [all, category])
  const byCat = useMemo(() => {
    const m = new Map<ExpenseCategory, number>()
    for (const x of all) m.set(x.category, (m.get(x.category) ?? 0) + x.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [all])
  const total = byCat.reduce((s, [, v]) => s + v, 0)
  const liters = all.reduce((s, x) => s + (x.category === 'fuel' ? (x.liters ?? 0) : 0), 0)

  const del = useMutation({
    mutationFn: (x: Expense) => api.deleteExpense(x.id),
    onSuccess: (_, x) => {
      void qc.invalidateQueries({ queryKey: qk.expenses() })
      toast.success('Expense deleted', fmtMoney(x.amount, currency))
      setDeleting(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="sm:w-44">
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory | '')} className="sm:w-48">
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_META[c].label}
            </option>
          ))}
        </Select>
        {canManage && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="sm:ml-auto">
            Add expense
          </Button>
        )}
      </div>

      {/* totals by category */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Total · {fmtDate(from)} – {fmtDate(to)}
            </div>
            <div className="tabular mt-1 text-[26px] font-semibold leading-none tracking-tight text-slate-900 dark:text-white">
              {q.isLoading ? '…' : fmtMoney(total, currency)}
            </div>
          </div>
          <div className="tabular text-right text-[12px] text-slate-500 dark:text-slate-400">
            {all.length} expense{all.length === 1 ? '' : 's'}
            {liters > 0 && ` · ${Math.round(liters).toLocaleString()} L fuel`}
          </div>
        </div>
        {total > 0 && (
          <>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
              {byCat.map(([c, v]) => (
                <div key={c} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(v / total) * 100}%`, background: expenseMeta(c).color }} title={`${expenseMeta(c).label}: ${fmtMoney(v, currency)}`} />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {byCat.map(([c, v]) => {
                const m = expenseMeta(c)
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(category === c ? '' : c)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
                      category === c ? 'border-brand-500 bg-brand-500/10' : 'border-slate-200/80 hover:border-slate-300 dark:border-white/[0.07] dark:hover:border-white/15',
                    )}
                  >
                    <CategoryIconChip c={c} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                        {m.label} · {v / total < 0.01 ? "<1" : Math.round((v / total) * 100)}%
                      </span>
                      <span className="tabular block truncate text-[13px] font-semibold text-slate-900 dark:text-white">{fmtMoney(v, currency)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load expenses" action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No expenses in this period" description="Log fuel, tolls (Salik), parking, fines and repairs to see cost per vehicle." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {rows.map((x) => {
              const m = expenseMeta(x.category)
              const dev = byId[x.deviceId]
              return (
                <li key={x.id} className="group flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  <CategoryIconChip c={x.category} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium text-slate-900 dark:text-white">{m.label}</span>
                      <span className="truncate text-[12px] text-slate-500 dark:text-slate-400">{dev?.name ?? `Vehicle #${x.deviceId}`}</span>
                    </div>
                    <div className="tabular mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">
                      {fmtDate(x.date)}
                      {x.liters ? ` · ${x.liters.toLocaleString()} L` : ''}
                      {x.odometer ? ` · ${fmtKm(x.odometer)}` : ''}
                      {x.notes ? ` · ${x.notes}` : ''}
                    </div>
                  </div>
                  <span className="tabular shrink-0 text-[14px] font-semibold text-slate-900 dark:text-white">{fmtMoney(x.amount, currency)}</span>
                  {canManageDevice(dev) && (
                    <div className="flex shrink-0 gap-0.5 sm:opacity-60 sm:group-hover:opacity-100">
                      <IconButton size="sm" label="Edit expense" onClick={() => setEditing(x)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton size="sm" label="Delete expense" onClick={() => setDeleting(x)} className="hover:!bg-rose-500/10 hover:!text-rose-500 max-sm:hidden">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {editing && <ExpenseForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} defaultDevice={deviceFilter ?? undefined} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title="Delete this expense?"
        description={deleting ? `${expenseMeta(deleting.category).label} · ${fmtMoney(deleting.amount, currency)} on ${fmtDate(deleting.date)}` : undefined}
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
      />
    </div>
  )
}
