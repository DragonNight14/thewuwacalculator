/*
  Author: Runor Ewhro
  description: builds lookup maps for echo and sonata set names to their
               corresponding image paths and set ids.
*/

import { listEchoes } from '@/data/catalog/echoCatalogService'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'
import { getPhantomEchoIcon } from '@/data/gameData/catalog/phantomEchoes'

// an echo can be met in a phantom form, whose art differs enough to need its own
// reference; both forms carry the same echo, so both keys answer with one name
const PHANTOM_KEY = '@phantom'

let echoMgMapCch: Record<string, string> | null = null
let echoVarOwners: Record<string, string> | null = null
let setNameMgMap: Record<string, string> | null = null
let setNameToIdC: Record<string, number> | null = null

function mkEchoMgMap(): Record<string, string> {
  const map: Record<string, string> = {}
  const owners: Record<string, string> = {}
  for (const echo of listEchoes()) {
    if (!echo.name || !echo.icon) continue
    map[echo.name] = echo.icon
    owners[echo.name] = echo.name

    const phantom = getPhantomEchoIcon(echo.id)
    if (phantom) {
      map[`${echo.name}${PHANTOM_KEY}`] = phantom
      owners[`${echo.name}${PHANTOM_KEY}`] = echo.name
    }
  }
  echoVarOwners = owners
  return map
}

function buildSetMaps(): void {
  const imageMap: Record<string, string> = {}
  const idMap: Record<string, number> = {}
  for (const set of SONATA_SETS) {
    if (set.name && set.icon) {
      imageMap[set.name] = set.icon
      idMap[set.name] = set.id
    }
  }
  setNameMgMap = imageMap
  setNameToIdC = idMap
}

// every reference the reader can match against, keyed by form
export function getEchoMgMap(): Record<string, string> {
  return (echoMgMapCch ??= mkEchoMgMap())
}

// the forms one echo can appear in
export function getEchoMgKeys(name: string): string[] {
  const map = getEchoMgMap()
  const phantom = `${name}${PHANTOM_KEY}`
  return map[phantom] ? [name, phantom] : [name]
}

// whether a matched form is the phantom one
export function isPhantomKey(key: string): boolean {
  return key.endsWith(PHANTOM_KEY)
}

// the echo behind a matched form
export function getEchoNamFrmKey(key: string | null): string | null {
  if (key === null) return null
  getEchoMgMap()
  return echoVarOwners?.[key] ?? key
}

export function getSetNameMg(): Record<string, string> {
  if (!setNameMgMap) buildSetMaps()
  return setNameMgMap!
}

export function getSetNameTo(): Record<string, number> {
  if (!setNameToIdC) buildSetMaps()
  return setNameToIdC!
}
