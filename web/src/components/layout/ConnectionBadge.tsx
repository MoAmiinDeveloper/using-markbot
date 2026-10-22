import { useLive } from '@/store/live'
import { liveConnection } from '@/store/connection'
import { cn } from '@/lib/cn'

export function ConnectionBadge({ compact }: { compact?: boolean }) {
  const ws = useLive((s) => s.ws)
  const meta =
    ws === 'open'
      ? { label: 'Live', dot: 'bg-emerald-500', ring: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', title: 'Receiving live updates' }
      : ws === 'reconnecting'
        ? { label: 'Reconnecting', dot: 'bg-amber-500', ring: '', text: 'text-amber-600 dark:text-amber-400', title: 'Connection lost — retrying. Click to retry now.' }
        : { label: 'Connecting', dot: 'bg-slate-400', ring: '', text: 'text-slate-500 dark:text-slate-400', title: 'Connecting to live updates' }
  return (
    <button
      type="button"
      onClick={() => ws !== 'open' && liveConnection.reconnectNow()}
      title={meta.title}
      aria-label={`Live connection: ${meta.label}`}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-medium shadow-soft dark:border-white/10 dark:bg-white/[0.03]',
        meta.text,
        compact && 'px-2.5',
      )}
    >
      <span className="relative flex h-2 w-2">
        {meta.ring && <span className={cn('absolute inset-0 animate-pulse-ring rounded-full', meta.ring)} />}
        <span className={cn('relative h-2 w-2 rounded-full', meta.dot, ws === 'reconnecting' && 'animate-pulse')} />
      </span>
      <span className={cn(compact && 'hidden sm:inline')}>{meta.label}</span>
    </button>
  )
}
