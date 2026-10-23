/*
  Author: Runor Ewhro
  description: hydrates explicit optimizer data snapshots in worker realms.
*/

import { hydrGameData } from '@/data/gameData'
import { initEchoCat } from '@/data/gameData/catalog/echoes'
import { initEchoStts } from '@/data/gameData/catalog/echoStats'
import { initResCat, initResDtls } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'
import { initEchoSetD } from '@/data/gameData/echoSets/effects'
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import type { OptStartPay } from '@/engine/optimizer/types'

/** install the same explicit snapshot in compile and replay workers. */
export function hydrateOptimizerGameData(
  snapshot: NonNullable<OptStartPay['staticData']>,
  mode?: GameDataMode,
): void {
  hydrGameData(snapshot.gameDataReg, mode)
  initResCat(Object.values(snapshot.resCatById))
  initResDtls(snapshot.resDtlsById)
  initWpnData(Object.values(snapshot.weaponsById))
  initEchoCat(Object.values(snapshot.echoCatById))
  initEchoSetD(snapshot.echoSetDefs)
  if (snapshot.echoStats) initEchoStts(snapshot.echoStats)
}
