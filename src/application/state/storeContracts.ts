/*
  Author: Runor Ewhro
  description: declares the shared read, write, persistence, and deferred-data
               contracts used by application store slices.
*/

import type { PersistKey } from '@/application/persistence/storage'
import type { AppStore } from './store'

export type StoreGet = () => AppStore
export type StoreSet = (updater: (state: AppStore) => AppStore) => void
export type PersistedSet = (
  domains: PersistKey[],
  updater: (state: AppStore) => AppStore,
  options?: { recHist?: boolean; historyLabel?: string | (() => string) },
) => void

export interface StoreSliceContext {
  get: StoreGet
  set: StoreSet
  persistedSet: PersistedSet
}
