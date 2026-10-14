/*
  Author: Runor Ewhro
  description: updates document theme classes during bootstrap, shell changes, and previews.
*/

import { ALL_THEMES } from '@/domain/entities/themes'

const DOCUMENT_THEME_CLASSES = [
  ...ALL_THEMES,
  'light-text', 'dark-text', 'blur-off', 'no-entrance-anim', 'reduce-animation',
]

export function applyDocumentTheme(
  variant: string,
  textMode: 'light' | 'dark',
  blurMode: boolean,
  entranceAnimations: boolean,
): void {
  const root = document.documentElement
  // earlier versions put variants on body; remove them so root tokens win.
  document.body.classList.remove(...DOCUMENT_THEME_CLASSES)
  root.classList.remove(...DOCUMENT_THEME_CLASSES)
  root.classList.add(variant, `${textMode}-text`)
  if (blurMode) root.classList.add('blur-off')
  if (!entranceAnimations) root.classList.add('no-entrance-anim', 'reduce-animation')
}
