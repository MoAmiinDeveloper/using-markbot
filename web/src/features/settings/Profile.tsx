import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useAuth } from '@/store/auth'
import { toast } from '@/store/toast'

/** Change display name and password (PATCH /me). */
export function ProfileForm() {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const [name, setName] = useState(user?.name ?? '')
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [touched, setTouched] = useState(false)

  const saveName = useMutation({
    meta: { silent: true },
    mutationFn: () => api.updateMe({ name: name.trim() }),
    onSuccess: (u) => {
      if (u) setUser({ ...user!, ...u })
      toast.success('Name updated')
    },
    onError: (e) => toast.error('Could not update your name', e instanceof ApiError ? e.message : String(e)),
  })
  const pwErr = pw && pw.length < 8 ? 'At least 8 characters' : pw2 && pw !== pw2 ? 'Passwords don’t match' : undefined
  const savePw = useMutation({
    meta: { silent: true },
    mutationFn: () => api.updateMe({ currentPassword: cur, newPassword: pw }),
    onSuccess: () => {
      setCur('')
      setPw('')
      setPw2('')
      setTouched(false)
      toast.success('Password changed')
    },
    onError: (e) => toast.error('Could not change the password', e instanceof ApiError ? e.message : String(e)),
  })
  const submitPw = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!cur || !pw || pwErr) return
    savePw.mutate()
  }

  return (
    <div className="space-y-4 py-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && name.trim() !== user?.name) saveName.mutate()
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <Field label="Display name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        </div>
        <Button type="submit" disabled={!name.trim() || name.trim() === user?.name} loading={saveName.isPending}>
          Save name
        </Button>
      </form>
      <form onSubmit={submitPw} className="space-y-3 rounded-xl bg-slate-50 p-3.5 dark:bg-white/[0.025]" noValidate>
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
          <KeyRound className="h-4 w-4 text-slate-400" /> Change password
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Current" error={touched && !cur ? 'Required' : undefined}>
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={cur} invalid={touched && !cur} onChange={(e) => setCur(e.target.value)} />}
          </Field>
          <Field label="New" error={touched ? (pw ? (pw.length < 8 ? 'At least 8 characters' : undefined) : 'Required') : undefined}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          </Field>
          <Field label="Repeat new" error={pw2 && pw !== pw2 ? 'Passwords don’t match' : undefined}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!cur || !pw || !pw2 || !!pwErr} loading={savePw.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </div>
  )
}
