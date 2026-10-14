/*
  Author: Runor Ewhro
  description: encodes and decodes persisted domains while retaining the
               established compressed-record prefix.
*/

import { compressToUTF16, decompressFromUTF16 } from 'lz-string'
import type { PersistKey } from './storage'

/** existing on-disk prefix shared by saved rotations and scenario records. */
export const COMPRESSED_ROTATIONS_PREFIX = 'wwcalc-lz1:'

export function encodePersistedDomain(key: PersistKey, value: unknown): string {
  const json = JSON.stringify(value)
  return key === 'library.rotations'
    ? `${COMPRESSED_ROTATIONS_PREFIX}${compressToUTF16(json)}`
    : json
}

export function decodePersistedDomain(key: PersistKey, raw: string): string {
  if (key !== 'library.rotations' || !raw.startsWith(COMPRESSED_ROTATIONS_PREFIX)) {
    return raw
  }

  const json = decompressFromUTF16(raw.slice(COMPRESSED_ROTATIONS_PREFIX.length))
  if (json == null) throw new Error('Compressed inventory rotations are invalid.')
  return json
}
