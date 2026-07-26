/*
  Author: Runor Ewhro
  Description: Shared live/beta game-data mode definitions.
*/

export type GameDataMode = 'live' | 'beta'

export const DEF_GAME_DATA_MODE: GameDataMode = 'beta'

export function gameDataModeFromBeta(enabled: boolean): GameDataMode {
  return enabled ? 'beta' : 'live'
}
