import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calculator, Tag } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { Device, ParamDef, ParamInput, ParamKind } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { useAccess } from '@/lib/access'
import { CATALOG, POSITION_FIELDS } from '@/lib/params'
import { useDeviceList } from '@/store/live'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { FormulaInput } from './FormulaInput'

export interface ParamDraft {
  kind: ParamKind
  key?: string
  deviceId?: number | null
  name?: string
  unit?: string
  expression?: string
}

type V = { kind: ParamKind; key: string; scope: string; name: string; unit: string; decimals: string; expression: string; hidden: boolean; position: string }

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** Create or edit a parameter name (mapped) or a calculated parameter. */
export function ParamForm({ initial, draft, defs, onClose }: { initial: ParamDef | null; draft?: ParamDraft; defs: ParamDef[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { isAdmin, canManageDevice } = useAccess()
  const devices = useDeviceList().filter((d) => canManageDevice(d))
  const [v, setV] = useState<V>(() => {
    const kind = initial?.kind ?? draft?.kind ?? 'mapped'
    const key = initial?.key ?? draft?.key ?? ''
    const cat = CATALOG[key]
    const deviceId = initial ? initial.deviceId : draft?.deviceId !== undefined ? draft.deviceId : isAdmin ? null : (devices[0]?.id ?? null)
    return {
      kind,
      key,
      scope: deviceId == null ? 'all' : String(deviceId),
      name: initial?.name ?? draft?.name ?? cat?.name ?? '',
      unit: initial?.unit ?? draft?.unit ?? cat?.unit ?? '',
      decimals: String(initial?.decimals ?? 2),
      expression: initial?.expression ?? draft?.expression ?? '',
      hidden: initial?.hidden ?? false,
      position: String(initial?.position ?? 0),
    }
  })
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof V>(k: K, val: V[K]) => setV((s) => ({ ...s, [k]: val }))
  const calc = v.kind === 'calculated'
  const errors: Partial<Record<keyof V, string>> = {}
  if (!KEY_RE.test(v.key)) errors.key = calc ? 'Letters, digits and _ ; start with a letter (e.g. fuelLiters)' : 'Pick or type the parameter key, e.g. io9'
  else if (calc && v.key in POSITION_FIELDS) errors.key = 'That is a built-in field — choose another key'
  if (!v.name.trim()) errors.name = 'Give it a name'
  if (calc && !v.expression.trim()) errors.expression = 'Write the formula'
  const show = (k: keyof V) => (touched ? errors[k] : undefined)
  const sampleDevices: Device[] = v.scope === 'all' ? devices : devices.filter((d) => String(d.id) === v.scope)

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const input: ParamInput = {
        kind: v.kind,
        key: v.key.trim(),
        deviceId: v.scope === 'all' ? null : Number(v.scope),
        name: v.name.trim(),
        unit: v.unit.trim(),
        decimals: Number(v.decimals) || 0,
        expression: calc ? v.expression.trim() : '',
        hidden: v.hidden,
        position: Number(v.position) || 0,
      }
      return initial ? api.updateParam(initial.id, input) : api.createParam(input)
    },
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: qk.params })
      toast.success(initial ? 'Parameter saved' : calc ? 'Calculated parameter added' : 'Parameter named', d.name)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the parameter'),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (Object.keys(errors).length) return
    save.mutate()
  }

  // raw keys reported by the selected devices, for the mapped-key picker
  const reported = Array.from(new Set(sampleDevices.flatMap((d) => Object.keys(d.position?.attributes ?? {})))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  return (
    <Drawer
      open
      onClose={onClose}
      wide={calc}
      title={initial ? `Edit ${initial.name}` : calc ? 'New calculated parameter' : 'Name a parameter'}
      subtitle={calc ? 'A formula computed on every record, stored like any other parameter' : 'Give a raw parameter (e.g. io9) a readable name and unit'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="param-form" loading={save.isPending}>
            {initial ? 'Save changes' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="param-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        {!initial && !draft?.key && (
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['mapped', 'Name a parameter', Tag],
                ['calculated', 'Calculated', Calculator],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={v.kind === k}
                onClick={() => set('kind', k)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-[12.5px] font-medium transition-colors',
                  v.kind === k
                    ? 'border-brand-500 bg-brand-500/10 text-navy-800 dark:text-brand-100'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        )}
        <Field label="Applies to" hint={v.scope === 'all' ? 'Every vehicle. A vehicle-specific definition with the same key wins.' : undefined}>
          {(id) => (
            <Select id={id} value={v.scope} onChange={(e) => set('scope', e.target.value)}>
              {isAdmin && <option value="all">All vehicles</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.plate ? ` · ${d.plate}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={calc ? 'Key' : 'Parameter key'} required error={show('key')} hint={calc ? 'Used in other formulas and events' : undefined}>
            {(id, d) => (
              <>
                <Input
                  id={id}
                  aria-describedby={d}
                  list={calc ? undefined : `${id}-keys`}
                  className="font-mono"
                  value={v.key}
                  invalid={!!show('key')}
                  placeholder={calc ? 'fuelLiters' : 'io9'}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const key = e.target.value.trim()
                    const cat = CATALOG[key]
                    setV((s) => ({ ...s, key, name: s.name || (!calc && cat ? cat.name : s.name), unit: s.unit || (!calc && cat?.unit ? cat.unit : s.unit) }))
                  }}
                />
                {!calc && (
                  <datalist id={`${id}-keys`}>
                    {reported.map((k) => (
                      <option key={k} value={k}>
                        {CATALOG[k]?.name ?? ''}
                      </option>
                    ))}
                  </datalist>
                )}
              </>
            )}
          </Field>
          <Field label="Name" required error={show('name')}>
            {(id, d) => <Input id={id} aria-describedby={d} value={v.name} invalid={!!show('name')} placeholder={calc ? 'Fuel in tank' : 'Fuel sensor'} onChange={(e) => set('name', e.target.value)} />}
          </Field>
        </div>
        {calc && (
          <Field label="Formula" required error={show('expression')}>
            {(id) => (
              <FormulaInput
                id={id}
                value={v.expression}
                onChange={(x) => set('expression', x)}
                devices={sampleDevices}
                defs={defs}
                invalid={!!show('expression')}
                placeholder="io9 / 1000 * 12.5"
                excludeKey={v.key}
              />
            )}
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit">{(id) => <Input id={id} value={v.unit} placeholder="L" maxLength={16} onChange={(e) => set('unit', e.target.value)} />}</Field>
          <Field label="Decimals">
            {(id) => (
              <Select id={id} value={v.decimals} onChange={(e) => set('decimals', e.target.value)}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Order" hint={calc ? 'Lower runs first' : undefined}>
            {(id) => <Input id={id} inputMode="numeric" value={v.position} onChange={(e) => set('position', e.target.value.replace(/\D/g, '').slice(0, 5))} />}
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/80 px-3 py-2.5 text-[12.5px] dark:border-white/[0.07]">
          <span>
            <span className="block font-medium text-slate-800 dark:text-slate-100">Hide in the parameters table</span>
            <span className="text-slate-500 dark:text-slate-400">It is still recorded and usable in formulas</span>
          </span>
          <Switch checked={v.hidden} onChange={(x) => set('hidden', x)} label="Hide in the parameters table" />
        </label>
      </form>
    </Drawer>
  )
}
