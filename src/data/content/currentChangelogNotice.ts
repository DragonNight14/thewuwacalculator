/*
  Author: Runor Ewhro
  description: exposes the generated release summary without importing the
               complete changelog dataset into persistent application code.
*/

import notice from './currentChangelogNotice.generated.json'

export const CURRENT_CHANGE_NOTICE = notice

export const CURRENT_CHANGE_NOTICE_KEY = notice.id
