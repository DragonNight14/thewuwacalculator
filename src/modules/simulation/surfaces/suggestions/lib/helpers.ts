/*
  Author: Runor Ewhro
  description: contains small suggestion formatting helpers shared by random
               and deterministic suggestion runs.
*/

import type { SimResult } from '@/engine/pipeline/types.ts'
import { isOptDmgSkll } from '@/engine/search/score/eligibility.ts'
import type { OptDamageEligibilityOptions as DmgEligOpts } from '@/engine/search/score/eligibility.ts'
import type { SelectGroup, SelectOption } from '@/application/ui/Select'
import { ROT_SKILL_TABS, getSkillTabLabel } from '@/modules/simulation/model/skillTabs.ts'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'
import type { SuggSets } from '@/domain/entities/suggestions.ts'

export const DEFAULT_ROTATION_TARGET = '__default_rotation__'

export function suggestionTargetValue(settings: SuggSets): string {
  return settings.rotationMode
    ? settings.rotationSourceId ?? DEFAULT_ROTATION_TARGET
    : settings.targetFeatureId ?? ''
}

export function selectSuggestionTarget(settings: SuggSets, value: string): SuggSets {
  const rotationMode = value === DEFAULT_ROTATION_TARGET
    || value === 'live'
    || value.startsWith('default:')
    || value.startsWith('saved:')
    || value.startsWith('scenario:')
  return {
    ...settings,
    rotationMode,
    targetFeatureId: rotationMode ? settings.targetFeatureId : value,
    rotationSourceId: rotationMode
      ? value === DEFAULT_ROTATION_TARGET ? null : value
      : settings.rotationSourceId,
  }
}

interface SuggTgtPtn {
  value: string
  label: string
  tab?: string
}

export const MDLEXITDURMS = 320

// collect the suggestion targets that are actually valid for the current runtime.
export function targetOpts(
  runtimeId: string,
  simulation: SimResult | null,
  options: DmgEligOpts = {},
  rotationSources?: Array<{ id: string; label: string }>,
): SuggTgtPtn[] {
  // a pending simulation cannot establish whether a saved manual target is valid.
  if (!simulation) return []
  const direct = (simulation?.allSkills ?? [])
    .filter((entry) => (
      entry.resonatorId === runtimeId &&
      entry.aggregationType === 'damage' &&
      isOptDmgSkll(entry.skill, options)
    ))
    .map((entry) => ({
      value: entry.id,
      label: entry.skill.tab === 'negativeEffect'
        ? entry.skill.label
        : (entry.feature.label || entry.skill.label),
      tab: entry.skill.tab,
    }))

  const defaults: SuggTgtPtn[] = rotationSources
    ? rotationSources.map((source) => ({
      value: source.id === `default:${runtimeId}` ? DEFAULT_ROTATION_TARGET : source.id,
      label: source.label,
    }))
    : getDefaultRotation(runtimeId)
      ? [{ value: DEFAULT_ROTATION_TARGET, label: 'Default Rotation' }]
      : []

  return [...defaults, ...direct]
}

// preserve skill-tab ordering and place targets without a skill tab in rotation.
export function targetGroups(options: SuggTgtPtn[]): SelectGroup<string>[] {
  const grouped = new Map<string, SelectOption<string>[]>()
  const extras: SelectOption<string>[] = []

  for (const option of options) {
    const entry: SelectOption<string> = { value: option.value, label: option.label }
    if (option.tab) {
      const list = grouped.get(option.tab) ?? []
      list.push(entry)
      grouped.set(option.tab, list)
    } else {
      extras.push(entry)
    }
  }

  const groups = ROT_SKILL_TABS
    .map((tab) => ({ label: getSkillTabLabel(tab), options: grouped.get(tab) ?? [] }))
    .filter((group) => group.options.length > 0)

  if (extras.length > 0) {
    const rotations = { label: 'Rotation', options: extras }
    if (extras.some((option) => option.value === DEFAULT_ROTATION_TARGET)) {
      groups.unshift(rotations)
    } else {
      groups.push(rotations)
    }
  }

  return groups
}
