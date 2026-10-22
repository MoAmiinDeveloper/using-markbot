import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Mail, Radar, Route, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { APP_NAME, APP_TAGLINE } from '@/config'
import { useAuth } from '@/store/auth'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/layout/TopBar'

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:p-12">
      {/* backdrop: grid + glow + stylised routes */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 40% 45%, black 30%, transparent 75%)',
        }}
      />
      <div className="absolute -left-24 top-1/4 h-[420px] w-[420px] rounded-full bg-brand-600/30 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[360px] w-[360px] rounded-full bg-emerald-500/20 blur-[120px]" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 600 700"
        preserveAspectRatio="xMidYMid slice"
        style={{ maskImage: 'linear-gradient(100deg, transparent 38%, rgb(0 0 0 / 0.35) 62%, black 85%)' }}
        aria-hidden
      >
        <defs>
          <linearGradient id="r1" x1="0" x2="1">
            <stop offset="0" stopColor="#5c8dfd" stopOpacity="0" />
            <stop offset="0.5" stopColor="#5c8dfd" />
            <stop offset="1" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d="M-20 520 C 120 470, 160 330, 290 340 S 470 230, 620 170" fill="none" stroke="url(#r1)" strokeWidth="3" strokeLinecap="round" />
        <path d="M-20 300 C 90 330, 180 260, 260 420 S 420 560, 620 520" fill="none" stroke="#f59e0b" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" />
        <path d="M120 720 C 160 600, 260 560, 330 470 S 420 300, 380 -20" fill="none" stroke="#0ea5e9" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
        {[
          [290, 340, '#10b981'],
          [455, 245, '#10b981'],
          [260, 420, '#f59e0b'],
          [330, 470, '#0ea5e9'],
          [150, 455, '#10b981'],
        ].map(([x, y, c], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="16" fill={c as string} opacity="0.18">
              <animate attributeName="r" values="8;22;8" dur={`${2.4 + i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0;0.35" dur={`${2.4 + i * 0.3}s`} repeatCount="indefinite" />
            </circle>
            <circle cx={x} cy={y} r="6.5" fill="#fff" />
            <circle cx={x} cy={y} r="4.5" fill={c as string} />
          </g>
        ))}
      </svg>

      <Logo className="relative text-white" />

      <div className="relative max-w-md">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] font-medium text-slate-300 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {APP_TAGLINE}
        </p>
        <h2 className="text-[34px] font-semibold leading-[1.15] tracking-tight text-white">
          Every vehicle, every second,
          <span className="bg-gradient-to-r from-brand-300 to-emerald-300 bg-clip-text text-transparent"> one map.</span>
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-slate-400">
          Live positions, trip history and fleet health from your Teltonika trackers — streamed straight to your browser.
        </p>
        <ul className="mt-8 grid gap-3 text-[13.5px] text-slate-300">
          {[
            [Radar, 'Real-time tracking with sub-second updates'],
            [Route, 'History playback with trips and stops'],
            [ShieldCheck, 'Self-hosted — your data stays yours'],
          ].map(([Icon, text], i) => {
            const I = Icon as typeof Radar
            return (
              <li key={i} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5">
                  <I className="h-4 w-4 text-brand-300" />
                </span>
                {text as string}
              </li>
            )
          })}
        </ul>
      </div>

      <p className="relative text-[12px] text-slate-500">© {new Date().getFullYear()} {APP_NAME}</p>
    </div>
  )
}

export function LoginPage() {
  const { token, reason, login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (loc.state as { from?: string } | null)?.from ?? '/live'
  if (token) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setLoading(true)
    try {
      const res = await api.login(email.trim(), password)
      login(res.token, res.user)
      nav(from, { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid email or password.'
          : err instanceof Error
            ? err.message
            : 'Sign-in failed.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full bg-white dark:bg-ink-900">
      <BrandPanel />
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between p-5 sm:p-6">
          <Logo className="text-slate-900 dark:text-white lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-6">
          <form onSubmit={submit} className="w-full max-w-[380px] animate-slide-up" noValidate>
            <h1 className="text-[26px] font-semibold tracking-tight text-slate-900 dark:text-white">Welcome back</h1>
            <p className="mt-1.5 text-slate-500 dark:text-slate-400">Sign in to your {APP_NAME} workspace.</p>

            {reason === 'expired' && !error && (
              <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-300">
                Your session expired. Please sign in again.
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-700 dark:text-rose-300"
              >
                {error}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <Field label="Email">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="email"
                    placeholder="admin@fleet.local"
                    icon={<Mail className="h-4 w-4" />}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    className="[&_input]:h-11"
                  />
                )}
              </Field>
              <Field label="Password">
                {(id) => (
                  <Input
                    id={id}
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    icon={<Lock className="h-4 w-4" />}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="[&_input]:h-11"
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShow((s) => !s)}
                        aria-label={show ? 'Hide password' : 'Show password'}
                        className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white"
                      >
                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                  />
                )}
              </Field>
            </div>

            <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-6 w-full">
              Sign in {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>

            <p className="mt-6 text-center text-[12px] text-slate-400 dark:text-slate-500">
              Default credentials are set by <code className="font-mono">ADMIN_EMAIL</code> /{' '}
              <code className="font-mono">ADMIN_PASSWORD</code> on the server.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
