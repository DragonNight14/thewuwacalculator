/*
  Author: Runor Ewhro
  description: thin logging helpers for the optimizer pipeline. all output
               is gated behind OPTIMIZER_LOGGING for control in
               one place without touching the call sites.
*/

import { OPT_LOGGING } from '@/engine/optimizer/config/constants.ts'

export function logOptimizer(message: string, data?: Record<string, unknown>): void {
  if (!OPT_LOGGING) {
    return
  }

  if (data !== undefined) {
    console.log(message, data)
  } else {
    console.log(message)
  }
}

export function warnOpt(message: string, data?: Record<string, unknown>): void {
  if (!OPT_LOGGING) {
    return
  }

  if (data !== undefined) {
    console.warn(message, data)
  } else {
    console.warn(message)
  }
}

export function errorOpt(message: string, data?: Record<string, unknown>): void {
  if (!OPT_LOGGING) {
    return
  }

  if (data !== undefined) {
    console.error(message, data)
  } else {
    console.error(message)
  }
}
