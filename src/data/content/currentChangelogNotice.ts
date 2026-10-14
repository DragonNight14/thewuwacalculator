/*
  Author: Runor Ewhro
  description: exposes the latest release summary without importing the complete
               changelog dataset into persistent application code.
*/

export const CURRENT_CHANGE_NOTICE = {
  date: '28/09/2026',
  patchVersion: '3.7 live',
  shortDesc: '3.7 patch update',
} as const

export const CURRENT_CHANGE_NOTICE_KEY =
  `${CURRENT_CHANGE_NOTICE.date}:${CURRENT_CHANGE_NOTICE.shortDesc}`
