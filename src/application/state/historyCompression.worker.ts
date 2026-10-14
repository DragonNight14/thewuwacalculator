/*
  Author: Runor Ewhro
  description: compresses history changes off-thread when their value structure
               can be represented losslessly as json.
*/

import { compressToUTF16 } from 'lz-string'
import type { PersistChange } from './history'

self.onmessage = (event: MessageEvent<PersistChange[]>) => {
  let hasNestedUndefined = false
  try {
    const json = JSON.stringify(event.data, function (this: unknown, key, value: unknown) {
      if (value === undefined && !(this && typeof this === 'object' && 'path' in this
        && (key === 'before' || key === 'after'))) hasNestedUndefined = true
      return value
    })
    self.postMessage({ packed: hasNestedUndefined ? null : compressToUTF16(json) })
  } catch {
    self.postMessage({ packed: null })
  }
}
