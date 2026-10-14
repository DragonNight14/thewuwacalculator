/*
  Author: Runor Ewhro
  description: restores weapon metadata for non-simulation routes while
               materializing a level table only if a saved weapon needs it.
*/

import type { GenWpn } from '@/domain/entities/weapon'

export interface CoreWeaponCatalog {
  levels: number[]
  weapons: Array<Omit<GenWpn, 'passive' | 'statsByLevel'> & {
    passiveName: string
    values: number[]
  }>
}

export function decodeCoreWeaponCatalog(catalog: CoreWeaponCatalog): GenWpn[] {
  const { levels } = catalog
  return catalog.weapons.map(({ passiveName, values, ...metadata }) => {
    const weapon = {
      ...metadata,
      passive: { name: passiveName, desc: '', params: [] },
    }
    Object.defineProperty(weapon, 'statsByLevel', {
      enumerable: true,
      configurable: true,
      get() {
        const table: GenWpn['statsByLevel'] = {}
        for (let index = 0; index < levels.length; index += 1) {
          table[levels[index]] = {
            atk: values[index * 2],
            secondaryStatValue: values[index * 2 + 1],
          }
        }
        Object.defineProperty(weapon, 'statsByLevel', { value: table, enumerable: true })
        return table
      },
    })
    return weapon as unknown as GenWpn
  })
}
