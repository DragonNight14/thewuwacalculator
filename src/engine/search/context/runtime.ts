/*
  Author: Runor Ewhro
  description: provides runtime preparation shared by every searcher before it builds
               a combat context.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'

// return a runtime copy with all equipped echoes removed.
//
// searchers evaluate inventory echoes separately, so the runtime used
// to build combat context excludes the currently equipped 5-piece set.
export function stripEchoes(runtime: ResRuntime): ResRuntime {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: [null, null, null, null, null],
    },
  }
}
