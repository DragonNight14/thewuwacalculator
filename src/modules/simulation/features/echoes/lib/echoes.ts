/*
  Author: Runor Ewhro
  description: calculates echo costs and provides canonical cost-based loadout ordering.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'

// read a catalog cost from an echo id with a configurable fallback
export function getEchoCostB(echoId: string, fallback = 0): number {
  return getEchoById(echoId)?.cost ?? fallback
}

// the cost budget a loadout is spent against, everywhere it is reported
export const MAX_ECHO_COST = 12

// read the effective cost for an equipped echo instance
export function getQppdEchoC(echo: Pick<EchoInstance, 'id' | 'mainEcho'>): number {
  return getEchoCostB(echo.id, echo.mainEcho ? 4 : 1)
}

// sum equipped echoes into the familiar 12-cost total
export function cmptTtlEchoC(echoes: Array<EchoInstance | null>): number {
  return echoes.reduce((total, echo) => (
    echo ? total + getEchoCostB(echo.id) : total
  ), 0)
}
