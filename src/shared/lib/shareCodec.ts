/*
  Author: Runor Ewhro
  Description: Compact share-token codec for clipboard payloads and share
               links. Tokens compress json behind a recognizable prefix so
               large clips survive chat message limits; decoding falls back to
               plain json so older copies keep working.
*/

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

export const SHR_TOKEN_PREFIX = 'wwcalc:'
export const SHR_LINK_FRAG = '#r='

// rotation clips shipped with their own prefix before the codec was shared.
const LEGACY_PREFIXES = ['wwcalc-rot:']

export function encShareText(payload: unknown): string {
  return SHR_TOKEN_PREFIX + compressToEncodedURIComponent(JSON.stringify(payload))
}

export function encShareLink(payload: unknown, path = '/calculator'): string {
  const token = compressToEncodedURIComponent(JSON.stringify(payload))
  return `${window.location.origin}${path}${SHR_LINK_FRAG}${token}`
}

// resolves share links, prefixed tokens, bare tokens, and plain json down to
// one json string; returns '' when a token fails to decompress.
export function decShareText(raw: string): string {
  const trimmed = raw.trim()

  const fragNdx = trimmed.indexOf(SHR_LINK_FRAG)
  if (fragNdx !== -1) {
    return decompressFromEncodedURIComponent(trimmed.slice(fragNdx + SHR_LINK_FRAG.length)) ?? ''
  }

  for (const prefix of [SHR_TOKEN_PREFIX, ...LEGACY_PREFIXES]) {
    if (trimmed.startsWith(prefix)) {
      return decompressFromEncodedURIComponent(trimmed.slice(prefix.length)) ?? ''
    }
  }

  if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    // a bare token pasted without its prefix still decodes when the result
    // looks like json.
    const guessed = decompressFromEncodedURIComponent(trimmed)
    if (guessed && (guessed.startsWith('{') || guessed.startsWith('['))) {
      return guessed
    }
  }

  return trimmed
}
