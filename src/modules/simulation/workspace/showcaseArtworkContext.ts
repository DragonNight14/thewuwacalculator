/*
  Author: Runor Ewhro
  description: shares an already resolved showcase backdrop without triggering
               a second media-resolution lifecycle in workspace descendants.
*/

import { createContext } from 'react'

export const ResolvedBackdropContext = createContext<string | null>(null)
