/*
  Author: Runor Ewhro
  description: registers context menu factories by location and resolves them
               for the current target.
*/

import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

export interface MenuContribution<TContext = unknown> {
  id: string
  group: string
  order?: number
  when?: (context: TContext) => boolean
  build: (context: TContext) => MenuEntry[]
}

interface RegisteredContribution {
  owner: symbol
  contribution: MenuContribution<never>
}

export function normalizeMenuEntries(entries: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.type === 'separator') {
      if (result.length > 0 && result.at(-1)?.type !== 'separator') result.push(entry)
      continue
    }
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    result.push(entry)
  }
  if (result.at(-1)?.type === 'separator') result.pop()
  return result
}

export function createMenuContributionRegistry() {
  const locations = new Map<string, RegisteredContribution[]>()

  return {
    register<TContext>(location: string, contributions: MenuContribution<TContext>[]) {
      const owner = Symbol(location)
      const registered = contributions.map((contribution) => ({
        owner,
        contribution: contribution as MenuContribution<never>,
      }))
      locations.set(location, [...(locations.get(location) ?? []), ...registered])
      return () => {
        const remaining = (locations.get(location) ?? []).filter((entry) => entry.owner !== owner)
        if (remaining.length) locations.set(location, remaining)
        else locations.delete(location)
      }
    },
    resolve<TContext>(location: string, context: TContext): MenuEntry[] {
      const registered = locations.get(location) ?? []
      const sorted = registered.slice().sort((a, b) =>
        a.contribution.group.localeCompare(b.contribution.group)
        || (a.contribution.order ?? 0) - (b.contribution.order ?? 0),
      )
      const entries: MenuEntry[] = []
      let lastGroup: string | null = null
      for (const { contribution } of sorted) {
        if (contribution.when && !contribution.when(context as never)) continue
        const built = normalizeMenuEntries(contribution.build(context as never))
        if (!built.length) continue
        if (lastGroup !== null && lastGroup !== contribution.group) entries.push({ type: 'separator' })
        entries.push(...built)
        lastGroup = contribution.group
      }
      return normalizeMenuEntries(entries)
    },
  }
}
