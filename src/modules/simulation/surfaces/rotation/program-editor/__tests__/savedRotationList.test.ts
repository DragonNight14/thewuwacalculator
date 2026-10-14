/*
  Author: Runor Ewhro
  description: verifies the savedRotationList.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary.ts'
import { defaultSavedPrefs, makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  makeSavedEntry as buildSvdLstEnt,
  makeSavedEntries as buildSvdLstEnts,
  groupSavedEntries,
  makeMemberTakes,
  rankSavedEntries,
  makeSavedRoster,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/savedRotationList.ts'

const calculatedSummaries = new WeakMap<SavedRotation, RotationComparisonSummary>()

function entry(
  partial: Partial<Omit<SavedRotation, 'scenario'>>
    & Pick<SavedRotation, 'id' | 'name'>
    & { resonatorId: string; resonatorName?: string; items?: RotationNode[] }
    & { summary?: RotationComparisonSummary },
): SavedRotation {
  const { summary, resonatorId, items = [], ...savedFields } = partial
  const seed = getResSeedBy('1108')
  if (!seed) throw new Error('Missing fixture resonator 1108')
  const profile = makeResProfile(seed)
  const scenario = makeScenarioFromProfiles({ [seed.id]: profile }, null, 0, seed.id)
  scenario.team.members[0].resonatorId = resonatorId
  scenario.program.program = items
  const saved: SavedRotation = {
    duration: 20,
    note: '',
    scenario,
    createdAt: 1,
    updatedAt: 1,
    ...savedFields,
  }
  if (summary) calculatedSummaries.set(saved, summary)
  return saved
}

function makeSavedEntry(...args: Parameters<typeof buildSvdLstEnt>) {
  const [saved, summary = calculatedSummaries.get(saved), decimals] = args
  return buildSvdLstEnt(saved, summary, decimals)
}

function makeSavedEntries(...args: Parameters<typeof buildSvdLstEnts>) {
  const [entries, prefs, query = '', summaries, decimals] = args
  const calculated = summaries ?? new Map(entries.flatMap((saved) => {
    const summary = calculatedSummaries.get(saved)
    return summary ? [[saved.id, summary] as const] : []
  }))
  return buildSvdLstEnts(entries, prefs, query, calculated, decimals)
}

describe('saved rotation list', () => {
  it('indexes every team member and keeps their damage attached to each saved entry', () => {
    const rows = [
      makeSavedEntry(entry({
        id: 'first',
        name: 'First take',
        resonatorId: 'a',
        summary: {
          total: { normal: 700, avg: 1000, crit: 1300 },
          members: [
            { id: 'a', name: 'A', contribution: { normal: 420, avg: 600, crit: 780 } },
            { id: 'b', name: 'B', contribution: { normal: 280, avg: 400, crit: 520 } },
          ],
        },
      })),
      makeSavedEntry(entry({
        id: 'second',
        name: 'Second take',
        resonatorId: 'c',
        summary: {
          total: { normal: 600, avg: 800, crit: 1000 },
          members: [
            { id: 'b', name: 'B', contribution: { normal: 150, avg: 200, crit: 250 } },
            { id: 'c', name: 'C', contribution: { normal: 450, avg: 600, crit: 750 } },
          ],
        },
      })),
    ]

    expect(makeSavedRoster(rows).map((member) => [member.id, member.damage, member.entries]))
      .toEqual([['a', 600, 1], ['b', 600, 2], ['c', 600, 1]])
    expect(makeMemberTakes(rows, 'b').map((take) => [take.id, take.damage, take.share]))
      .toEqual([['first', 400, 0.4], ['second', 200, 0.25]])
  })

  it('finds a rotation by any contributing resonator', () => {
    const rotations = [entry({
      id: 'team',
      name: 'Opening sequence',
      resonatorId: 'a',
      resonatorName: 'Augusta',
      summary: {
        total: { normal: 700, avg: 1000, crit: 1300 },
        members: [
          { id: 'a', name: 'Augusta', contribution: { normal: 420, avg: 600, crit: 780 } },
          { id: 'b', name: 'Iuno', contribution: { normal: 280, avg: 400, crit: 520 } },
        ],
      },
    })]

    expect(makeSavedEntries(rotations, defaultSavedPrefs(), 'iuno').map((row) => row.id))
      .toEqual(['team'])
  })

  it('groups by the active resonator and orders sections by their own best', () => {
    const prefs = defaultSavedPrefs()
    const rows = makeSavedEntries([
      entry({
        id: 'a-weak',
        name: 'A weak',
        resonatorId: 'a',
        resonatorName: 'A',
        updatedAt: 1,
        summary: { total: { normal: 1, avg: 100, crit: 120 } },
      }),
      entry({
        id: 'b-best',
        name: 'B best',
        resonatorId: 'b',
        resonatorName: 'B',
        updatedAt: 2,
        summary: { total: { normal: 1, avg: 400, crit: 500 } },
      }),
      entry({
        id: 'a-strong',
        name: 'A strong',
        resonatorId: 'a',
        resonatorName: 'A',
        updatedAt: 3,
        summary: { total: { normal: 1, avg: 300, crit: 350 } },
      }),
    ], prefs)

    const groups = groupSavedEntries(rows)
    expect(groups.map((group) => group.lead.id)).toEqual(['b', 'a'])
    expect(groups[1]?.takes.map((take) => take.id)).toEqual(['a-strong', 'a-weak'])
  })

  it('keeps simulated rotations only and sorts with the shared preferences', () => {
    const entries = [
      entry({
        id: 'older',
        name: 'Older take',
        resonatorId: 'a',
        resonatorName: 'A',
        updatedAt: 10,
        summary: { total: { normal: 1, avg: 200, crit: 250 } },
      }),
      entry({
        id: 'recent',
        name: 'Recent take',
        resonatorId: 'b',
        resonatorName: 'B',
        updatedAt: 20,
        summary: { total: { normal: 1, avg: 50, crit: 80 } },
      }),
    ]

    expect(makeSavedEntries(entries, defaultSavedPrefs()).map((row) => row.id))
      .toEqual(['recent', 'older'])

    expect(makeSavedEntries(entries, {
      ...defaultSavedPrefs(),
      sortBy: 'avg',
      sortOrder: 'desc',
    }).map((row) => row.id)).toEqual(['older', 'recent'])
  })

  it('uses recalculated summaries exclusively when the archive supplies them', () => {
    const saved = entry({
      id: 'team',
      name: 'Current result',
      resonatorId: 'a',
      resonatorName: 'A',
      summary: { total: { normal: 900, avg: 999, crit: 1_100 } },
    })
    const recalculated = new Map([[
      saved.id,
      { total: { normal: 100, avg: 123, crit: 150 } },
    ]])

    expect(makeSavedEntries([saved], defaultSavedPrefs(), '', recalculated)[0]?.avg).toBe(123)
    expect(makeSavedEntries([saved], defaultSavedPrefs(), '', new Map())).toEqual([])
  })

  it('filters by members that actually contributed damage', () => {
    const rotations = [
      entry({
        id: 'solo',
        name: 'Solo',
        resonatorId: 'a',
        summary: {
          total: { normal: 0, avg: 100, crit: 0 },
          members: [
            { id: 'a', name: 'A', contribution: { normal: 0, avg: 100, crit: 0 } },
            { id: 'b', name: 'B', contribution: { normal: 0, avg: 0, crit: 0 } },
          ],
        },
      }),
      entry({
        id: 'duo',
        name: 'Duo',
        resonatorId: 'a',
        summary: {
          total: { normal: 0, avg: 100, crit: 0 },
          members: [
            { id: 'a', name: 'A', contribution: { normal: 0, avg: 60, crit: 0 } },
            { id: 'b', name: 'B', contribution: { normal: 0, avg: 40, crit: 0 } },
          ],
        },
      }),
    ]

    expect(makeSavedEntries(rotations, {
      ...defaultSavedPrefs(),
      contributionFilter: 'solo',
    }).map((row) => row.id)).toEqual(['solo'])
    expect(makeSavedEntries(rotations, {
      ...defaultSavedPrefs(),
      contributionFilter: 'duo',
    }).map((row) => row.id)).toEqual(['duo'])
  })

  it('numbers the archive by what is in it and gives the live take the rank it would take', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'best',
        name: 'Best',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 300, crit: 300 } },
      }),
      entry({
        id: 'live-rotation:a',
        name: 'Live',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 200, crit: 200 } },
      }),
      entry({
        id: 'worst',
        name: 'Worst',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 100, crit: 100 } },
      }),
    ], { ...defaultSavedPrefs(), sortBy: 'avg', sortOrder: 'desc' })

    expect(rows.map((row) => [row.id, row.live])).toEqual([
      ['best', false],
      ['live-rotation:a', true],
      ['worst', false],
    ])

    const ranks = rankSavedEntries(rows)
    /* the live take shows its projected rank. saved takes retain their ranks. */
    expect(ranks.get('best')).toBe(1)
    expect(ranks.get('live-rotation:a')).toBe(2)
    expect(ranks.get('worst')).toBe(2)
  })

  it('orders a bank by its saved work', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'live-rotation:a',
        name: 'Live',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 500, crit: 500 } },
      }),
      entry({
        id: 'kept-a',
        name: 'Kept A',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 100, crit: 100 } },
      }),
      entry({
        id: 'kept-b',
        name: 'Kept B',
        resonatorId: 'b',
        summary: { total: { normal: 0, avg: 300, crit: 300 } },
      }),
    ], { ...defaultSavedPrefs(), sortBy: 'avg', sortOrder: 'desc' })

    const groups = groupSavedEntries(rows)

    /* bank order follows saved work; b leads despite a's higher live preview. */
    expect(groups.map((group) => group.lead.id)).toEqual(['b', 'a'])
    expect(groups.find((group) => group.lead.id === 'a')?.best).toBe(100)
  })

  it('filters the live take with the rest of the archive', () => {
    const rotations = [
      entry({
        id: 'live-rotation:a',
        name: 'Carlotta Live Rotation',
        resonatorId: 'a',
        resonatorName: 'Carlotta',
        summary: { total: { normal: 0, avg: 200, crit: 200 } },
      }),
      entry({
        id: 'kept',
        name: 'Jinhsi Concerto',
        resonatorId: 'b',
        resonatorName: 'Jinhsi',
        summary: { total: { normal: 0, avg: 100, crit: 100 } },
      }),
    ]

    expect(makeSavedEntries(rotations, defaultSavedPrefs(), 'jinhsi').map((row) => row.id))
      .toEqual(['kept'])
    expect(makeSavedEntries(rotations, defaultSavedPrefs(), 'carlotta').map((row) => row.id))
      .toEqual(['live-rotation:a'])
  })
})
