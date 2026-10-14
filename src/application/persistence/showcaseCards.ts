/*
  Author: Runor Ewhro
  description: persists showcase cards independently, publishing the index only after records are safe.
*/
import type { PersistedState } from '@/domain/entities/appState'
import { showcaseCardSchema } from '@/engine/runtime/schema'
import { APP_STORAGE_KEY } from './storageKeys'

export const SHOWCASE_INDEX = `${APP_STORAGE_KEY}.ui.showcase-cards`
const PREFIX = `${SHOWCASE_INDEX}.card.`
type Cards = PersistedState['ui']['preferences']['showcaseCards']
const saved = new Map<string, Cards[string]>()

export function readShowcaseCards(): Cards | null {
  saved.clear()
  const raw = localStorage.getItem(SHOWCASE_INDEX)
  if (!raw) return null
  try {
    const ids: unknown = JSON.parse(raw)
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null
    const cards: Cards = {}
    for (const id of ids) {
      try {
        const result = showcaseCardSchema.safeParse(JSON.parse(localStorage.getItem(PREFIX + encodeURIComponent(id)) ?? 'null'))
        if (result.success) Object.defineProperty(cards, id, { value: result.data, enumerable: true, writable: true, configurable: true })
      } catch { /* a damaged record must not discard the other cards. */ }
    }
    return cards
  } catch { return null }
}

export function writeShowcaseCards(cards: Cards): void {
  const ids = Object.keys(cards)
  let previous: string[] = []
  try { const parsed: unknown = JSON.parse(localStorage.getItem(SHOWCASE_INDEX) ?? '[]'); if (Array.isArray(parsed)) previous = parsed.filter((id): id is string => typeof id === 'string') } catch { /* replace a corrupt index after writing valid records. */ }
  for (const id of ids) {
    if (saved.get(id) === cards[id] && localStorage.getItem(PREFIX + encodeURIComponent(id)) != null) continue
    const parsed = showcaseCardSchema.parse(cards[id])
    localStorage.setItem(PREFIX + encodeURIComponent(id), JSON.stringify(parsed))
  }
  // a failed record write leaves the legacy layout and previous index usable.
  const index = JSON.stringify(ids)
  if (localStorage.getItem(SHOWCASE_INDEX) !== index) localStorage.setItem(SHOWCASE_INDEX, index)
  for (const id of previous) if (!Object.hasOwn(cards, id)) localStorage.removeItem(PREFIX + encodeURIComponent(id))
  saved.clear()
  for (const id of ids) saved.set(id, cards[id])
}

export function clearShowcaseCards(): void {
  saved.clear()
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
  localStorage.removeItem(SHOWCASE_INDEX)
}
