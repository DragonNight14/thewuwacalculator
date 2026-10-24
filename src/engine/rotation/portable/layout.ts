/*
  Author: Runor Ewhro
  description: defines the stable candidate-input layout shared by portable
               rotation compilation and both execution backends.
*/
export const TEAM_INPUT = { echoStats: 0, setCounts: 100, echoIds: 139, echoSets: 144, mainId: 149, mainPosition: 150, presence: 151, totals: 156, selfMainEchoEffects: 176, count: 177 } as const
export { ECHO_STAT_KEYS } from '@/engine/search/layout/echoLayout'
