/*
  Author: Runor Ewhro
  description: joins the status report's coverage domains with live catalog
               counts; enemy data resolves asynchronously.
*/

import { useEffect, useMemo, useState } from 'react'
import { STATUS_DATA } from '@/data/content/appStatus'
import { listResonatorSeeds, listEchoes } from '@/data/catalog/catalogService'
import { getWeapons } from '@/data/gameData/weapons/weaponDataStore'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'
import { loadEnemySummary } from '@/data/catalog/enemyCatalogService'

export function useCoverage() {
  const [enemies, setEnemies] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void loadEnemySummary()
        .then((entries) => { if (live) setEnemies(Object.keys(entries).length) })
        .catch(() => { if (live) setEnemies(null) })
    return () => { live = false }
  }, [])

  return useMemo(() => {
    const size: Record<string, number | null> = {
      resonators: listResonatorSeeds().length,
      weapons: getWeapons().length,
      echoes: listEchoes().length,
      enemies,
    }
    return STATUS_DATA.coverage.map((domain) => ({
      ...domain,
      count: size[domain.key] ?? null,
      extra: domain.key === 'echoes' ? `${SONATA_SETS.length} sets` : '',
    }))
  }, [enemies])
}
