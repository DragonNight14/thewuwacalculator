/*
  Author: Runor Ewhro
  description: archives advanced content found in old compact-sequence storage
               before discarding that retired editable field.
*/

import {
  contextScenarioMember,
  reviseCombatScenario,
} from '@/domain/entities/combatScenario.ts'
import type {
  SavedArtifactLibrary,
  SavedRotation,
} from '@/domain/entities/inventoryStorage.ts'
import {
  cloneRotationNodes,
  makeSavedRotation,
  savedRotationItems,
  savedRotationResonatorId,
} from '@/domain/entities/inventoryStorage.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary.ts'
import { isRotationSequence } from '@/domain/gameData/rotationSequence.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { mkDefRot } from '@/engine/runtime/defaults.ts'

export interface AdvancedRotationMigration {
  profileId: string
  savedRotation: SavedRotation
  created: boolean
}

export interface AdvancedScenarioMigrationResult {
  library: SavedArtifactLibrary
  combat: ScenarioWorkspace
  migrations: AdvancedRotationMigration[]
}

function sameRotationItems(left: readonly RotationNode[], right: readonly RotationNode[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function findArchivedRotation(
  rotations: readonly SavedRotation[],
  resonatorId: string,
  items: readonly RotationNode[],
): SavedRotation | null {
  return rotations.find((entry) => (
    savedRotationResonatorId(entry) === resonatorId
    && sameRotationItems(savedRotationItems(entry), items)
  )) ?? null
}

function makeMigrationName(
  resonatorName: string,
  rotations: readonly SavedRotation[],
): string {
  const base = `${resonatorName} Advanced Rotation`
  const names = new Set(rotations.map((entry) => entry.name))
  if (!names.has(base)) return base

  let suffix = 2
  while (names.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
}

/** migrate every working scenario independently without creating another live slot. */
export function migrateAdvancedScenarioRotations(
  library: SavedArtifactLibrary,
  combat: ScenarioWorkspace,
  now = Date.now(),
): AdvancedScenarioMigrationResult {
  let rotations = library.rotations
  let scenariosById = combat.scenariosById
  const migrations: AdvancedRotationMigration[] = []

  for (const scenarioId of combat.order) {
    const scenario = scenariosById[scenarioId]
    if (!scenario) continue
    const contextMember = contextScenarioMember(scenario)
    const resonatorId = contextMember.resonatorId
    const items = scenario.program.sequence
    if (isRotationSequence(items, resonatorId)) continue

    const seed = getResSeedBy(resonatorId)

    let savedRotation = findArchivedRotation(rotations, resonatorId, items)
    const created = !savedRotation
    if (!savedRotation) {
      savedRotation = makeSavedRotation({
        name: makeMigrationName(seed?.name ?? resonatorId, rotations),
        duration: 0,
        note: '',
        scenario: {
          ...scenario,
          program: {
            ...scenario.program,
            program: cloneRotationNodes(items),
          },
        },
      }, now)
      savedRotation.migration = {
        source: 'advanced-sequence',
        acknowledged: true,
      }
      rotations = [...rotations, savedRotation]
    } else if (savedRotation.migration?.source !== 'advanced-sequence') {
      savedRotation = {
        ...savedRotation,
        migration: {
          source: 'advanced-sequence',
          acknowledged: true,
        },
      }
      rotations = rotations.map((entry) => entry.id === savedRotation?.id ? savedRotation : entry)
    }

    const defaultItems = seed ? mkDefRot(seed).sequence : []
    const migratedScenario = reviseCombatScenario(scenario, {
      program: {
        ...scenario.program,
        sequence: isRotationSequence(defaultItems, resonatorId)
          ? cloneRotationNodes(defaultItems)
          : [],
      },
    })
    scenariosById = {
      ...scenariosById,
      [scenarioId]: migratedScenario,
    }
    migrations.push({ profileId: resonatorId, savedRotation, created })
  }

  if (migrations.length === 0) return { library, combat, migrations }

  return {
    combat: { ...combat, scenariosById },
    library: { ...library, rotations },
    migrations,
  }
}
