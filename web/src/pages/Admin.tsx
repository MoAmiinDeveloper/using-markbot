import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Eye,
  EyeOff,
  FolderTree,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import { ROLES, type Group, type User, type UserInput } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { GroupChip, RoleBadge } from '@/components/ui/Badges'
import { Switch } from '@/components/ui/Switch'
import { Tabs } from '@/components/ui/Tabs'
import { DeviceChecklist } from '@/features/common/DeviceMultiSelect'
import { useGroups } from '@/features/common/queries'
import { GEOFENCE_COLORS } from '@/features/geofences/shape'
import { ROLE_META, normRole, type EffectiveRole } from '@/lib/access'
import { useAuth } from '@/store/auth'
import { useLive } from '@/store/live'
import { useNow } from '@/store/now'
import { toast } from '@/store/toast'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

const GROUP_COLORS = ['#ffd700', ...GEOFENCE_COLORS.filter((c) => c.toLowerCase() !== '#ffd700')].slice(0, 10)

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const a = new Uint32Array(14)
  crypto.getRandomValues(a)
  return Array.from(a, (n) => chars[n % chars.length]).join('')
}

function PasswordInput({ id, value, onChange, invalid, describedBy }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        aria-describedby={describedBy}
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        value={value}
        invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        icon={<KeyRound className="h-4 w-4" />}
        className="flex-1 [&_input]:font-mono"
        trailing={
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      />
      <Button
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        onClick={() => {
          onChange(genPassword())
          setShow(true)
        }}
      >
        Generate
      </Button>
    </div>
  )
}

function GroupPicker({ groups, value, onChange }: { groups: Group[]; value: number[]; onChange: (ids: number[]) => void }) {
  if (!groups.length) return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-[12.5px] text-slate-500 dark:border-white/10">No groups yet — create one in the Groups tab.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => {
        const on = value.includes(g.id)
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
              on ? 'border-brand-500 bg-brand-500/12 text-navy-800 dark:text-brand-100' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-slate-300',
            )}
          >
            {on ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />}
            {g.name}
            <span className="text-[11px] text-slate-400">{g.deviceIds.length}</span>
          </button>
        )
      })}
    </div>
  )
}

function UserForm({ initial, groups, onClose }: { initial: User | null; groups: Group[]; onClose: () => void }) {
  const qc = useQueryClient()
  const me = useAuth((s) => s.user)
  const self = !!initial && initial.id === me?.id
  const [v, setV] = useState<UserInput>(() => ({
    email: initial?.email ?? '',
    name: initial?.name ?? '',
    password: initial ? '' : genPassword(),
    role: initial ? normRole(initial.role) : 'viewer',
    groupIds: initial?.groupIds ?? [],
    active: initial?.active ?? true,
  }))
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof UserInput>(k: K, val: UserInput[K]) => setV((s) => ({ ...s, [k]: val }))
  const errors: Partial<Record<keyof UserInput, string>> = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errors.email = 'Enter a valid email'
  if (!v.name.trim()) errors.name = 'Name is required'
  if (!initial && (v.password ?? '').length < 8) errors.password = 'At least 8 characters'
  const show = (k: keyof UserInput) => (touched ? errors[k] : undefined)

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const body: Partial<UserInput> = { email: v.email.trim(), name: v.name.trim(), role: v.role, groupIds: v.groupIds }
      if (!initial) return api.createUser({ ...(body as UserInput), password: v.password })
      if (!self) body.active = v.active
      return api.updateUser(initial.id, body)
    },
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: qk.users })
      toast.success(initial ? 'User updated' : 'User created', initial ? u.name : `${u.email} — share the password securely`)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the user'),
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
      title={initial ? 'Edit user' : 'Invite user'}
      subtitle={initial ? initial.email : 'Create an account and choose what they can see and do'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form" loading={save.isPending}>
            {initial ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        <Field label="Full name" required error={show('name')}>
          {(id, d) => <Input id={id} aria-describedby={d} data-autofocus value={v.name} invalid={!!show('name')} placeholder="Hodan Abdi" onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label="Email" required error={show('email')}>
          {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="off" value={v.email} invalid={!!show('email')} placeholder="hodan@somtel.so" onChange={(e) => set('email', e.target.value)} />}
        </Field>
        {!initial && (
          <Field label="Initial password" required error={show('password')} hint={show('password') ? undefined : 'They can change it under Settings → Account'}>
            {(id, d) => <PasswordInput id={id} describedBy={d} value={v.password ?? ''} invalid={!!show('password')} onChange={(p) => set('password', p)} />}
          </Field>
        )}
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Role</span>
          <div role="radiogroup" aria-label="Role" className="space-y-1.5">
            {ROLES.map((r) => {
              const on = v.role === r
              const m = ROLE_META[r as EffectiveRole]
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={self && r !== 'admin'}
                  onClick={() => set('role', r)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    on ? 'border-brand-500 bg-brand-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
                  )}
                >
                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full border-2', on ? 'border-navy-700 dark:border-brand-400' : 'border-slate-300 dark:border-white/25')}>
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-navy-700 dark:bg-brand-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-slate-900 dark:text-white">{m.label}</span>
                    <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{m.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {self && <p className="text-[11.5px] text-slate-500">You can’t demote yourself.</p>}
        </div>
        {v.role !== 'admin' && (
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Groups</span>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">They only see vehicles in these groups.</p>
            <GroupPicker groups={groups} value={v.groupIds} onChange={(ids) => set('groupIds', ids)} />
          </div>
        )}
        {initial && !self && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
            <div>
              <p className="text-[13px] font-medium text-slate-900 dark:text-white">Active</p>
              <p className="text-[11.5px] text-slate-500">Inactive users can’t sign in</p>
            </div>
            <Switch checked={!!v.active} onChange={(a) => set('active', a)} label="Active" />
          </div>
        )}
      </form>
    </Drawer>
  )
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = useState(genPassword)
  const reset = useMutation({
    meta: { silent: true },
    mutationFn: () => api.updateUser(user.id, { password: pw }),
    onSuccess: () => {
      toast.success('Password reset', `Share the new password with ${user.name} securely.`)
      onClose()
    },
    onError: (e) => toast.error('Could not reset the password', e instanceof ApiError ? e.message : String(e)),
  })
  return (
    <Modal
      open
      onClose={() => !reset.isPending && onClose()}
      title={`Reset ${user.name}’s password`}
      description="They’ll need the new password at their next sign-in. Existing sessions stay valid until they expire."
      className="max-w-lg"
      footer={
        <>
          <Button onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={reset.isPending} disabled={pw.length < 8} onClick={() => reset.mutate()}>
            Reset password
          </Button>
        </>
      }
    >
      <div className="mt-4">
        <PasswordInput value={pw} onChange={setPw} invalid={pw.length > 0 && pw.length < 8} />
        {pw.length > 0 && pw.length < 8 && <p className="mt-1.5 text-[12px] text-rose-500">At least 8 characters</p>}
      </div>
    </Modal>
  )
}

function UsersTab({ groups }: { groups: Group[] }) {
  const qc = useQueryClient()
  const now = useNow()
  const me = useAuth((s) => s.user)
  const users = useQuery({ queryKey: qk.users, queryFn: api.users })
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<User | null | 'new'>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const list = useMemo(() => users.data ?? [], [users.data])
  const admins = list.filter((u) => normRole(u.role) === 'admin' && u.active !== false).length
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return list.filter((u) => !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)).sort((a, b) => a.name.localeCompare(b.name))
  }, [list, q])
  const gname = (id: number) => groups.find((g) => g.id === id)

  const toggleActive = useMutation({
    meta: { silent: true },
    mutationFn: (u: User) => api.updateUser(u.id, { active: u.active === false }),
    onMutate: (u) => qc.setQueryData<User[]>(qk.users, (l) => l?.map((x) => (x.id === u.id ? { ...x, active: u.active === false } : x))),
    onSuccess: (u) => toast.success(u.active === false ? 'User deactivated' : 'User activated', u.name),
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: qk.users })
      toast.error('Could not update the user', e instanceof ApiError ? e.message : String(e))
    },
  })
  const del = useMutation({
    mutationFn: (u: User) => api.deleteUser(u.id),
    onSuccess: (_, u) => {
      qc.setQueryData<User[]>(qk.users, (l) => l?.filter((x) => x.id !== u.id))
      toast.success('User deleted', u.email)
      setDeleting(null)
    },
  })
  const lastAdmin = (u: User) => normRole(u.role) === 'admin' && admins <= 1

  const groupCell = (u: User) =>
    normRole(u.role) === 'admin' ? (
      <span className="text-[12px] text-slate-500 dark:text-slate-400">All vehicles</span>
    ) : u.groupIds?.length ? (
      <div className="flex flex-wrap gap-1">
        {u.groupIds.map((id) => {
          const g = gname(id)
          return g ? <GroupChip key={id} name={g.name} color={g.color} /> : null
        })}
      </div>
    ) : (
      <span className="inline-flex items-center gap-1 text-[12px] text-amber-600 dark:text-amber-400">
        <TriangleAlert className="h-3 w-3" /> No groups — sees nothing
      </span>
    )
  const actions = (u: User) => (
    <>
      <IconButton size="sm" label={`Edit ${u.name}`} onClick={() => setEditing(u)}>
        <Pencil className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton size="sm" label={`Reset password for ${u.name}`} onClick={() => setResetting(u)}>
        <KeyRound className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        size="sm"
        label={u.id === me?.id ? 'You can’t delete yourself' : lastAdmin(u) ? 'Can’t delete the last admin' : `Delete ${u.name}`}
        disabled={u.id === me?.id || lastAdmin(u)}
        onClick={() => setDeleting(u)}
        className="hover:!bg-rose-500/10 hover:!text-rose-500"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </>
  )

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-slate-200/80 p-3 dark:border-white/[0.06] sm:flex-row sm:items-center">
        <Input icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search users" className="sm:max-w-xs sm:flex-1" />
        <div className="flex flex-wrap gap-1.5 text-[12px] text-slate-500 sm:ml-auto">
          {ROLES.map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <RoleBadge role={r} /> {list.filter((u) => normRole(u.role) === r).length}
            </span>
          ))}
        </div>
        <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Invite user
        </Button>
      </div>
      {users.isLoading ? (
        <div className="space-y-px p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : users.isError ? (
        <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load users" action={<Button onClick={() => void users.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<SearchX className="h-5 w-5" />} title="No users match" />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-navy-50/80 text-navy-700/80 [&_th]:font-semibold text-left text-[12px] dark:bg-white/[0.02] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Groups</th>
                  <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                  <th className="px-4 py-2.5 font-medium">Active</th>
                  <th className="px-4 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {rows.map((u) => (
                  <tr key={u.id} className={cn('group transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.02]', u.active === false && 'opacity-60')}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand-500 text-[12px] font-semibold text-navy-900">{initials(u.name)}</span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900 dark:text-white">
                            {u.name}
                            {u.id === me?.id && <span className="ml-1.5 text-[11px] font-normal text-slate-400">(you)</span>}
                          </div>
                          <div className="truncate text-[12px] text-slate-500 dark:text-slate-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="max-w-[280px] px-4 py-2.5">{groupCell(u)}</td>
                    <td className="tabular whitespace-nowrap px-4 py-2.5 text-slate-600 dark:text-slate-300">{u.lastLoginAt ? timeAgo(u.lastLoginAt, now) : <span className="text-slate-400">Never</span>}</td>
                    <td className="px-4 py-2.5">
                      <Switch size="sm" checked={u.active !== false} disabled={u.id === me?.id || (lastAdmin(u) && u.active !== false)} label={`${u.name} active`} onChange={() => toggleActive.mutate(u)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">{actions(u)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.05] md:hidden">
            {rows.map((u) => (
              <li key={u.id} className={cn('px-3 py-3', u.active === false && 'opacity-60')}>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand-500 text-[12.5px] font-semibold text-navy-900">{initials(u.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900 dark:text-white">{u.name}</span>
                      <RoleBadge role={u.role} />
                    </div>
                    <div className="truncate text-[12px] text-slate-500 dark:text-slate-400">{u.email}</div>
                  </div>
                  <Switch size="sm" checked={u.active !== false} disabled={u.id === me?.id || lastAdmin(u)} label={`${u.name} active`} onChange={() => toggleActive.mutate(u)} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 pl-[52px]">
                  <div className="min-w-0">{groupCell(u)}</div>
                  <div className="-mr-1 flex shrink-0">{actions(u)}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && <UserForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} groups={groups} onClose={() => setEditing(null)} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'user'}?`}
        description="They lose access immediately. Commands they sent stay in the history. Prefer deactivating if they may come back."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete user
            </Button>
          </>
        }
      />
    </div>
  )
}

function GroupForm({ initial, onClose }: { initial: Group | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? GROUP_COLORS[0])
  const [ids, setIds] = useState<number[]>(initial?.deviceIds ?? [])
  const [touched, setTouched] = useState(false)
  const err = !name.trim() ? 'Name the group' : undefined
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => (initial ? api.updateGroup(initial.id, { name: name.trim(), color, deviceIds: ids }) : api.createGroup({ name: name.trim(), color, deviceIds: ids })),
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: qk.groups })
      toast.success(initial ? 'Group saved' : 'Group created', `${g.name} · ${g.deviceIds.length} vehicles`)
      onClose()
    },
    onError: (e) => toast.error('Could not save the group', e instanceof ApiError ? e.message : String(e)),
  })
  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? 'Edit group' : 'New group'}
      subtitle="Managers and viewers only see vehicles of their groups"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTouched(true)
              if (!err) save.mutate()
            }}
          >
            {initial ? 'Save changes' : 'Create group'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={touched ? err : undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} data-autofocus value={name} invalid={touched && !!err} placeholder="Mogadishu depot" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Colour</span>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn('grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-ink-900', color === c && 'ring-2 ring-slate-900 dark:ring-white')}
                style={{ background: c }}
              >
                {color === c && <Check className={cn('h-3.5 w-3.5', c === '#ffd700' ? 'text-navy-900' : 'text-white')} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Vehicles</span>
            <span className="tabular text-[11.5px] text-slate-500">{ids.length} selected</span>
          </div>
          <DeviceChecklist value={ids} onChange={setIds} maxHeight="max-h-[46vh]" />
        </div>
      </div>
    </Drawer>
  )
}

function GroupsTab({ groups, loading }: { groups: Group[]; loading: boolean }) {
  const qc = useQueryClient()
  const byId = useLive((s) => s.byId)
  const users = useQuery({ queryKey: qk.users, queryFn: api.users, meta: { silent: true } })
  const [editing, setEditing] = useState<Group | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Group | null>(null)
  const del = useMutation({
    mutationFn: (g: Group) => api.deleteGroup(g.id),
    onSuccess: (_, g) => {
      qc.setQueryData<Group[]>(qk.groups, (l) => l?.filter((x) => x.id !== g.id))
      toast.success('Group deleted', g.name)
      setDeleting(null)
    },
  })
  const members = (g: Group) => (users.data ?? []).filter((u) => u.groupIds?.includes(g.id))
  const ungrouped = Object.values(byId).filter((d) => !groups.some((g) => g.deviceIds.includes(d.id))).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          {groups.length} group{groups.length === 1 ? '' : 's'}
          {ungrouped > 0 && <> · <span className="font-medium text-amber-600 dark:text-amber-400">{ungrouped} vehicle{ungrouped === 1 ? '' : 's'} in no group</span> (admins only)</>}
        </p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="ml-auto">
          New group
        </Button>
      </div>
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={<FolderTree className="h-5 w-5" />} title="No groups yet" description="Group vehicles by depot, region or customer, then give managers and viewers access to their groups." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => {
            const m = members(g)
            return (
              <article key={g.id} className="card flex flex-col overflow-hidden">
                <div className="h-1" style={{ background: g.color }} />
                <div className="flex items-start gap-3 px-4 pb-2 pt-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${g.color}26`, color: g.color === '#ffd700' ? '#b89b00' : g.color }}>
                    <FolderTree className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{g.name}</h3>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">
                      {g.deviceIds.length} vehicle{g.deviceIds.length === 1 ? '' : 's'} · {m.length} member{m.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <IconButton size="sm" label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton size="sm" label={`Delete ${g.name}`} onClick={() => setDeleting(g)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
                <div className="flex flex-wrap gap-1 px-4 pb-3">
                  {g.deviceIds.slice(0, 6).map((id) => (
                    <span key={id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11.5px] text-slate-700 dark:bg-white/[0.07] dark:text-slate-200">
                      {byId[id]?.name ?? `#${id}`}
                    </span>
                  ))}
                  {g.deviceIds.length > 6 && <span className="px-1 py-0.5 text-[11.5px] text-slate-400">+{g.deviceIds.length - 6} more</span>}
                </div>
                {m.length > 0 && (
                  <div className="mt-auto flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 dark:border-white/[0.05]">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    <div className="flex -space-x-1.5">
                      {m.slice(0, 5).map((u) => (
                        <span key={u.id} title={`${u.name} (${normRole(u.role)})`} className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand-500 text-[9.5px] font-semibold text-navy-900 ring-2 ring-white dark:ring-ink-900">
                          {initials(u.name)}
                        </span>
                      ))}
                    </div>
                    <span className="truncate text-[11.5px] text-slate-500">{m.map((u) => u.name.split(' ')[0]).join(', ')}</span>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
      {editing && <GroupForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete group “${deleting?.name ?? ''}”?`}
        description="Vehicles aren’t deleted, but members of this group lose access to them."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete group
            </Button>
          </>
        }
      />
    </div>
  )
}

type Tab = 'users' | 'groups'

export default function AdminPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'groups' ? 'groups' : 'users'
  const groups = useGroups()
  const users = useQuery({ queryKey: qk.users, queryFn: api.users, meta: { silent: true } })
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Users & Groups</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Who can sign in, what they can do, and which vehicles they see</p>
        </div>
        <Tabs<Tab>
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          tabs={[
            { id: 'users', label: 'Users', icon: <Users />, count: users.data?.length },
            { id: 'groups', label: 'Groups', icon: <FolderTree />, count: groups.data?.length },
          ]}
        />
        {tab === 'users' ? <UsersTab groups={groups.data ?? []} /> : <GroupsTab groups={groups.data ?? []} loading={groups.isLoading} />}
      </div>
    </div>
  )
}
