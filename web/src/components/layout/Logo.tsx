import { useId } from 'react'
import { APP_NAME } from '@/config'
import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  // unique id: a gradient defined inside a display:none subtree would not render elsewhere
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5c8dfd" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path d="M16 6.5 L23.5 24.5 L16 20.3 L8.5 24.5 Z" fill="#fff" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">{APP_NAME}</span>
    </span>
  )
}
