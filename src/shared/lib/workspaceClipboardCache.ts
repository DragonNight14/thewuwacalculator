/*
  Author: Runor Ewhro
  description: retains the last workspace clipboard payload as a same-session
               fallback when system clipboard reads are unavailable.
*/

let lastWrittenText: string | null = null

export function rememberWorkspaceClipboardText(text: string): void {
  lastWrittenText = text
}

export function lastWorkspaceClipboardText(): string | null {
  return lastWrittenText
}
