import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, ImageOff, Paperclip, Signature, Upload } from 'lucide-react'
import { ApiError, api, fetchFileBlob } from '@/api/client'
import type { Attachment, AttachmentKind, Job } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { fmtShortDateTime } from '@/lib/format'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { useStoreJob } from './queries'

// object URLs are cached for the session so thumbnails and the lightbox share one download
const cache = new Map<string, Promise<{ url: string; type: string }>>()
function loadBlob(url: string) {
  let p = cache.get(url)
  if (!p) {
    p = fetchFileBlob(url)
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}

export function useAuthBlob(url: string | null) {
  const [state, setState] = useState<{ url?: string; type?: string; error?: string }>({})
  useEffect(() => {
    if (!url) return
    let alive = true
    setState({})
    loadBlob(url).then(
      (r) => alive && setState(r),
      (e) => alive && setState({ error: e instanceof ApiError ? e.message : 'Could not load' }),
    )
    return () => {
      alive = false
    }
  }, [url])
  return state
}

const isImage = (a: Attachment) => (a.contentType ? a.contentType.startsWith('image/') : a.kind !== 'document' || /\.(png|jpe?g|webp)$/i.test(a.name))
const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const KIND_LABEL: Record<AttachmentKind, string> = { photo: 'Photo', signature: 'Signature', document: 'Document' }

function Thumb({ a, onOpen, stopName }: { a: Attachment; onOpen: () => void; stopName?: string }) {
  const img = isImage(a)
  const blob = useAuthBlob(img ? a.url : null)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-xl border border-slate-200/80 bg-white text-left shadow-soft transition-shadow hover:shadow-md dark:border-white/[0.07] dark:bg-ink-850"
    >
      <div className={cn('relative grid aspect-[4/3] place-items-center overflow-hidden', a.kind === 'signature' ? 'bg-white' : 'bg-slate-100 dark:bg-white/[0.04]')}>
        {img ? (
          blob.url ? (
            <img src={blob.url} alt={a.name} className={cn('h-full w-full transition-transform group-hover:scale-[1.03]', a.kind === 'signature' ? 'object-contain p-2' : 'object-cover')} />
          ) : blob.error ? (
            <ImageOff className="h-6 w-6 text-slate-400" />
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )
        ) : (
          <FileText className="h-8 w-8 text-rose-500" />
        )}
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-navy-900/75 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          {a.kind === 'signature' ? <Signature className="h-3 w-3" /> : a.kind === 'photo' ? null : <Paperclip className="h-3 w-3" />}
          {KIND_LABEL[a.kind] ?? a.kind}
        </span>
      </div>
      <div className="px-2.5 py-1.5">
        <p className="truncate text-[11.5px] font-medium text-slate-800 dark:text-slate-100">{stopName ?? a.name}</p>
        <p className="tabular text-[10.5px] text-slate-500 dark:text-slate-400">{fmtShortDateTime(a.createdAt)}</p>
      </div>
    </button>
  )
}

function Lightbox({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const blob = useAuthBlob(a.url)
  const img = isImage(a)
  return (
    <Modal open onClose={onClose} title={a.name} className="!max-w-3xl" description={[KIND_LABEL[a.kind] ?? a.kind, fmtShortDateTime(a.createdAt), a.size ? fmtBytes(a.size) : null].filter(Boolean).join(' · ')}>
      <div className={cn('mt-4 grid min-h-[200px] place-items-center overflow-hidden rounded-xl', a.kind === 'signature' ? 'bg-white' : 'bg-slate-100 dark:bg-black/30')}>
        {blob.error ? (
          <p className="p-8 text-[12.5px] text-rose-500">{blob.error}</p>
        ) : !blob.url ? (
          <Skeleton className="h-[320px] w-full" />
        ) : img ? (
          <img src={blob.url} alt={a.name} className="max-h-[65vh] w-auto object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-10 text-slate-500">
            <FileText className="h-10 w-10 text-rose-500" />
            <span className="text-[12.5px]">{a.name}</span>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {blob.url && (
          <>
            <a
              href={blob.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-soft hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              <ExternalLink className="h-4 w-4" /> Open
            </a>
            <a
              href={blob.url}
              download={a.name}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-3.5 text-[13px] font-semibold text-navy-900 shadow-sm hover:bg-brand-400"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        )}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

export function AttachmentsGallery({ job, canUpload }: { job: Job; canUpload: boolean }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  const [busy, setBusy] = useState(false)
  const store = useStoreJob()
  const stopName = (id: number | null) => (id == null ? undefined : job.stops.find((s) => s.id === id)?.name)
  const list = [...(job.attachments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast.error('File too large', 'Attachments can be at most 10 MB.')
    setBusy(true)
    try {
      const kind: AttachmentKind = file.type === 'application/pdf' ? 'document' : 'photo'
      const a = await api.uploadJobAttachment(job.id, file, kind)
      store({ ...job, attachments: [...(job.attachments ?? []), a] })
      toast.success('File attached', a.name)
    } catch (e) {
      toast.error('Upload failed', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {canUpload && (
        <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-[12.5px] font-medium text-slate-600 hover:border-brand-500 hover:bg-brand-500/[0.04] dark:border-white/15 dark:text-slate-300', busy && 'pointer-events-none opacity-60')}>
          <Upload className="h-4 w-4" />
          {busy ? 'Uploading…' : 'Attach photo or PDF'}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
      )}
      {list.length === 0 ? (
        <EmptyState icon={<Paperclip className="h-5 w-5" />} title="No attachments yet" description="Photos and signatures captured in the driver app appear here as proof of delivery." className="py-6" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((a) => (
            <Thumb key={a.id} a={a} stopName={stopName(a.stopId)} onOpen={() => setOpen(a)} />
          ))}
        </div>
      )}
      {open && <Lightbox a={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
