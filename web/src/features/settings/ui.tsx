import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'

export function SettingsCard({
  id,
  icon,
  title,
  description,
  badge,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  description?: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card scroll-mt-4 overflow-hidden">
      <header className="flex items-start gap-3 border-b border-slate-200/80 px-4 py-3.5 dark:border-white/[0.06] sm:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-300 [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-slate-900 dark:text-white">
            {title}
            {badge}
          </h2>
          {description && <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  )
}

export function AdminBadge() {
  return (
    <span className="rounded bg-amber-500/12 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
      Admin
    </span>
  )
}

export function useCopy(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false)
  const copy = (text: string) => {
    const ok = () => {
      setDone(true)
      window.setTimeout(() => setDone(false), 1500)
    }
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text) && ok())
    else if (fallbackCopy(text)) ok()
  }
  return [done, copy]
}

/** execCommand fallback for plain-http deployments where the async clipboard API is unavailable. */
function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

export function CopyField({ value, label, mono = true, multiline }: { value: string; label: string; mono?: boolean; multiline?: boolean }) {
  const [done, copy] = useCopy()
  return (
    <div className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-black/25">
      <pre
        className={cn(
          'overflow-x-auto py-2.5 pl-3 pr-24 text-[12px] leading-relaxed text-slate-800 dark:text-slate-200',
          mono && 'font-mono',
          multiline ? 'whitespace-pre' : 'whitespace-nowrap',
        )}
        aria-label={label}
      >
        {value}
      </pre>
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label={done ? 'Copied' : `Copy ${label}`}
        className={cn(
          'absolute right-1.5 top-1.5 inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium shadow-soft transition-colors',
          done
            ? 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
            : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-white/10 dark:bg-ink-800 dark:text-slate-300 dark:hover:text-white',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {children.map((c, i) => (
        <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
          <span className="tabular grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/12 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 pt-px">{c}</span>
        </li>
      ))}
    </ol>
  )
}

export const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-slate-100 px-1 py-px font-mono text-[11.5px] text-slate-800 dark:bg-white/[0.08] dark:text-slate-200">{children}</code>
)
