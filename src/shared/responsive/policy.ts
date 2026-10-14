/*
  Author: Runor Ewhro
  description: exports canonical responsive breakpoints and scale settings to
               runtime code and the stylesheet build transform.
*/

import policy from './policy.json'

export const RESPONSIVE_POLICY = policy

export const RESPONSIVE_MEDIA = {
  phoneCapability: policy.phoneCapabilityQuery,
  wideRail: `(min-width: ${policy.breakpointsPx.wideRailMin}px)`,
} as const
