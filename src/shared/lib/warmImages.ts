/*
  Author: Runor Ewhro
  description: shares bounded image decoding across callers. cancellation drops
               queued work without aborting downloads another caller still needs.
*/
const warmed = new Set<string>()
interface WarmJob { src: string; owners: Set<symbol> }
const pending = new Map<string, WarmJob>()
const queue: WarmJob[] = []
const MAX_ACTIVE = 4
const MAX_REMEMBERED = 256
let active = 0

interface WarmOptions { cap?: number }
interface DataSaver { saveData?: boolean; effectiveType?: string }

function connectionAllows() {
  if (typeof navigator === 'undefined') return false
  const link = (navigator as Navigator & { connection?: DataSaver }).connection
  return !link?.saveData && (!link?.effectiveType || /4g|5g/.test(link.effectiveType))
}

function warmOne(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.fetchPriority = 'low'
    const timeout = window.setTimeout(() => settle(false), 15_000)
    const settle = (success: boolean) => {
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      resolve(success)
    }
    image.onload = () => image.decode().then(() => settle(true), () => settle(false))
    image.onerror = () => settle(false)
    image.src = src
  })
}

function drain() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift()!
    if (!job.owners.size) {
      if (pending.get(job.src) === job) pending.delete(job.src)
      continue
    }
    active += 1
    void warmOne(job.src).then((success) => {
      if (success) {
        warmed.add(job.src)
        if (warmed.size > MAX_REMEMBERED) warmed.delete(warmed.values().next().value!)
      }
    }).finally(() => {
      pending.delete(job.src)
      active -= 1
      drain()
    })
  }
}

export function warmImages(sources: readonly string[], { cap = 24 }: WarmOptions = {}): () => void {
  if (typeof window === 'undefined' || !connectionAllows()) return () => undefined
  const owner = Symbol('image warm owner')
  const jobs = [...new Set(sources)].filter((src) => src && !warmed.has(src)).slice(0, Math.max(0, cap)).map((src) => {
    let job = pending.get(src)
    if (!job) {
      job = { src, owners: new Set() }
      pending.set(src, job)
      queue.push(job)
    }
    job.owners.add(owner)
    return job
  })
  drain()
  return () => { for (const job of jobs) job.owners.delete(owner) }
}
