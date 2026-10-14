/*
  Author: Runor Ewhro
  description: counts persisted references to each rover identity so conversion
               impact is known before a gender preference is committed.
*/

import type { SavedArtifactLibrary } from '@/domain/entities/inventoryStorage'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import { ROVER_PAIRS } from '@/domain/entities/roverGender'

export type RoverForm = 'male' | 'female'

export interface RoverSaveCount {
  builds: number
  rotations: number
  scenarios: number
  // each attribute pair is converted independently.
  byAttribute: Record<string, number>
  // saves containing both identities from the same attribute pair.
  shared: number
}

const emptyCount = (): RoverSaveCount => ({ builds: 0, rotations: 0, scenarios: 0, byAttribute: {}, shared: 0 })

export function countRoverSaves(library: SavedArtifactLibrary): Record<RoverForm, RoverSaveCount> {
  const counts = { male: emptyCount(), female: emptyCount() }
  const formById = new Map<string, { form: RoverForm; attribute: string }>()
  for (const pair of ROVER_PAIRS) {
    formById.set(pair.male, { form: 'male', attribute: pair.attribute })
    formById.set(pair.female, { form: 'female', attribute: pair.attribute })
  }

  const mark = (form: RoverForm, attribute: string) => {
    counts[form].byAttribute[attribute] = (counts[form].byAttribute[attribute] ?? 0) + 1
  }

  for (const build of library.builds) {
    const hit = formById.get(build.resonatorId)
    if (!hit) continue
    counts[hit.form].builds += 1
    mark(hit.form, hit.attribute)
  }

  // count dormant teammate setups too: they are persisted in the save and converted.
  // a save counts once per stored form, however many rover forms it contains.
  const tallyScenario = (scenario: CombatScenario | undefined, kind: 'rotations' | 'scenarios') => {
    const members = scenario?.team?.members
    if (!members) return
    const forms = new Set<RoverForm>()
    const formByAttribute = new Map<string, RoverForm>()
    const resonatorIds = new Set([
      ...members.map((member) => member.resonatorId),
      ...Object.keys(scenario.dormantMembersByResonatorId ?? {}),
    ])
    for (const resonatorId of resonatorIds) {
      const hit = formById.get(resonatorId)
      if (!hit) continue
      forms.add(hit.form)
      mark(hit.form, hit.attribute)
      const prior = formByAttribute.get(hit.attribute)
      if (prior && prior !== hit.form) {
        counts.male.shared += 1
        counts.female.shared += 1
      }
      formByAttribute.set(hit.attribute, hit.form)
    }
    for (const form of forms) counts[form][kind] += 1
  }

  for (const entry of library.rotations) tallyScenario(entry.scenario, 'rotations')
  for (const entry of library.scenarios) tallyScenario(entry.scenario, 'scenarios')

  return counts
}

export function totalRoverSaves(count: RoverSaveCount): number {
  return count.builds + count.rotations + count.scenarios
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function describeRoverSaves(count: RoverSaveCount): string {
  const parts: string[] = []
  if (count.builds) parts.push(plural(count.builds, 'build'))
  if (count.rotations) parts.push(plural(count.rotations, 'rotation'))
  if (count.scenarios) parts.push(plural(count.scenarios, 'scenario'))
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export { plural as pluralSaves }
