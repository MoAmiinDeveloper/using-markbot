import { Cable, Waypoints } from 'lucide-react'
import type { DeviceSource } from '@/api/types'
import { cn } from '@/lib/cn'

/** Direct (our gateway) vs Traccar (bridged) device source. */
export function SourceBadge({ source, className }: { source: DeviceSource | undefined; className?: string }) {
  const traccar = source === 'traccar'
  const Icon = traccar ? Waypoints : Cable
  return (
    <span
      title={traccar ? 'Positions forwarded from a Traccar server — commands not supported' : 'Connected directly to the FleetOS gateway'}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide',
        traccar
          ? 'bg-violet-500/12 text-violet-700 dark:bg-violet-400/12 dark:text-violet-300'
          : 'bg-slate-500/10 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {traccar ? 'Traccar' : 'Direct'}
    </span>
  )
}
