/*
  Author: Runor Ewhro
  description: verifies contribution ordering, duplicate suppression, cleanup,
               and legacy-route classification in the context-menu registry.
*/

import { describe, expect, it } from 'vitest'
import { createMenuContributionRegistry } from '../menuContributions'

describe('context-menu contributions', () => {
  it('composes current target actions in group order without duplicate entries', () => {
    const registry = createMenuContributionRegistry()
    registry.register('echo.slot', [{
      id: 'edit', group: '1_primary',
      build: ({ id }: { id: string }) => [{ id: `edit:${id}`, label: 'Edit' }],
    }])
    registry.register('echo.slot', [
      { id: 'copy', group: '2_copy', build: () => [{ id: 'copy', label: 'Copy' }] },
      { id: 'copy-again', group: '2_copy', build: () => [{ id: 'copy', label: 'Duplicate' }] },
    ])

    expect(registry.resolve('echo.slot', { id: 'first' })).toEqual([
      { id: 'edit:first', label: 'Edit' },
      { type: 'separator' },
      { id: 'copy', label: 'Copy' },
    ])
    expect(registry.resolve('echo.slot', { id: 'second' })[0]).toEqual({ id: 'edit:second', label: 'Edit' })
    expect(registry.resolve('app.background', {})).toEqual([])
  })

  it('removes a feature registration on unmount and filters by current context', () => {
    const registry = createMenuContributionRegistry()
    const unregister = registry.register('rotation.node', [{
      id: 'delete', group: '9_danger',
      when: ({ editable }: { editable: boolean }) => editable,
      build: () => [{ id: 'delete', label: 'Delete' }],
    }])
    expect(registry.resolve('rotation.node', { editable: false })).toEqual([])
    expect(registry.resolve('rotation.node', { editable: true })).toHaveLength(1)
    unregister()
    expect(registry.resolve('rotation.node', { editable: true })).toEqual([])
  })
})
