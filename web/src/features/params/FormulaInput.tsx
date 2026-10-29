import { useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CircleHelp, FlaskConical } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Device, ParamDef, ParamTestResult } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Input'
import { FORMULA_FUNCTIONS, formatValue, paramRows } from '@/lib/params'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * Formula editor: text area, clickable parameters of a sample device (with
 * their current values) and a "Test" button that evaluates the formula on
 * that device's latest fix.
 */
export function FormulaInput({
  id,
  value,
  onChange,
  devices,
  defs,
  invalid,
  placeholder,
  boolean,
  excludeKey,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  devices: Device[]
  defs: ParamDef[]
  invalid?: boolean
  placeholder?: string
  /** conditions: show the result as true / false */
  boolean?: boolean
  /** the parameter being edited (not offered as an input) */
  excludeKey?: string
}) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const reporting = useMemo(() => devices.filter((d) => d.position), [devices])
  const [sampleId, setSampleId] = useState<number | null>(reporting[0]?.id ?? null)
  const sample = reporting.find((d) => d.id === sampleId) ?? reporting[0]
  const [help, setHelp] = useState(false)
  const [result, setResult] = useState<ParamTestResult | { error: string; compile: true } | null>(null)
  const rows = useMemo(() => (sample ? paramRows(sample, sample.position, defs).filter((r) => r.key !== excludeKey) : []), [sample, defs, excludeKey])

  const test = useMutation({
    meta: { silent: true },
    mutationFn: () => api.testExpression(value, sample?.id),
    onSuccess: setResult,
    onError: (e) => setResult({ error: e instanceof ApiError ? e.message : 'Could not test the formula', compile: true }),
  })

  const insert = (text: string) => {
    const el = ta.current
    if (!el) return onChange(value + text)
    const a = el.selectionStart ?? value.length
    const b = el.selectionEnd ?? value.length
    const pre = value.slice(0, a)
    const sep = pre && !/[\s(,!]$/.test(pre) ? ' ' : ''
    const next = pre + sep + text + value.slice(b)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = a + sep.length + text.length
      el.setSelectionRange(pos, pos)
    })
    setResult(null)
  }

  const shown = result && 'value' in result && !result.error ? result.value : undefined
  return (
    <div className="space-y-2">
      <Textarea
        id={id}
        ref={ta}
        rows={2}
        value={value}
        invalid={invalid}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={placeholder}
        className="font-mono text-[12.5px]"
        onChange={(e) => {
          onChange(e.target.value)
          setResult(null)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {reporting.length > 0 && (
          <Select aria-label="Test on vehicle" value={sample?.id ?? ''} onChange={(e) => setSampleId(Number(e.target.value))} className="h-8 w-auto max-w-[220px] text-[12px]">
            {reporting.map((d) => (
              <option key={d.id} value={d.id}>
                Test on {d.name}
              </option>
            ))}
          </Select>
        )}
        <Button type="button" size="sm" icon={<FlaskConical className="h-3.5 w-3.5" />} disabled={!value.trim()} loading={test.isPending} onClick={() => test.mutate()}>
          Test
        </Button>
        <button type="button" onClick={() => setHelp((h) => !h)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
          <CircleHelp className="h-3.5 w-3.5" /> {help ? 'Hide help' : 'How to write formulas'}
        </button>
      </div>
      {result && (
        <div
          role="status"
          className={cn(
            'rounded-lg px-3 py-2 text-[12.5px]',
            result.error
              ? 'border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
              : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
          )}
        >
          {result.error ? (
            'compile' in result ? (
              result.error
            ) : result.missing ? (
              <>The formula is valid, but {sample?.name ?? 'this vehicle'}’s latest data does not include {result.error.replace(/^missing value: /, '')}.</>
            ) : (
              result.error
            )
          ) : (
            <>
              Result on {sample?.name}: <b className="font-mono">{boolean ? (shown ? 'true — would trigger' : 'false — would not trigger') : formatValue(shown, 6)}</b>
              {'time' in result && result.time && <span className="opacity-70"> · data from {timeAgo(result.time)}</span>}
            </>
          )}
        </div>
      )}
      {help && (
        <div className="space-y-1.5 rounded-lg border border-slate-200/80 p-3 text-[12px] text-slate-600 dark:border-white/[0.07] dark:text-slate-300">
          <p>
            Use parameter keys, numbers and <code className="font-mono">+ − * / %</code>, comparisons <code className="font-mono">{'== != < <= > >='}</code> and <code className="font-mono">and or not</code> (or{' '}
            <code className="font-mono">{'&& || !'}</code>). Text goes in quotes. Examples:
          </p>
          <ul className="space-y-0.5 font-mono text-[11.5px] text-slate-800 dark:text-slate-100">
            <li>io9 / 1000 * 12.5</li>
            <li>ignition and speed {'>'} 80</li>
            <li>if(in2, &quot;Door open&quot;, &quot;Closed&quot;)</li>
          </ul>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {FORMULA_FUNCTIONS.map((f) => (
              <li key={f.sig}>
                <button type="button" className="font-mono text-[11.5px] text-navy-700 hover:underline dark:text-brand-300" onClick={() => insert(f.sig.split(' ')[0].replace(/\(.*$/, '()'))}>
                  {f.sig}
                </button>{' '}
                <span className="text-slate-500 dark:text-slate-400">— {f.help}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-500 dark:text-slate-400">If a parameter is missing from a record, the formula is skipped for that record.</p>
        </div>
      )}
      {rows.length > 0 && (
        <div>
          <p className="mb-1 text-[11.5px] text-slate-500 dark:text-slate-400">Click to insert · values from {sample?.name}</p>
          <div className="flex max-h-[132px] flex-wrap gap-1 overflow-y-auto">
            {rows.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => insert(r.key)}
                title={r.name}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11.5px] hover:border-brand-500 hover:bg-brand-500/10 dark:border-white/10"
              >
                <span className="font-mono text-slate-800 dark:text-slate-100">{r.key}</span>
                <span className="truncate text-slate-400">{r.display}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
