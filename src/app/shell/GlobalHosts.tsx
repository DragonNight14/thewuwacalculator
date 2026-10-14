/*
  Author: Runor Ewhro
  description: mounts app-wide singleton hosts outside the route lifecycle so
               their state survives navigation.
*/

import { lazy, Suspense, useState } from 'react'
import { NavHold } from '@/app/nav/NavHold'
import { DlyNtc } from '@/app/shell/DailyNotice'
import { NtfcTstCntn } from '@/shared/ui/NotificationToast'
import { CookieBanner } from '@/app/shell/CookieBanner'
import { BetaNoticeModal } from '@/app/shell/BetaNoticeModal'
import { useCkBnnr } from '@/app/hooks/useCookieBanner.ts'
import { useEchoImportRequested } from '@/modules/simulation/api/chromeRequests'

const EchoImportHost = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).EchoImportHost }))
const ImportStamp = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).ImportStamp }))
const EnemyConsoleHost = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).EnemyConsoleHost }))

export function GlobalHosts({ simulating }: { simulating: boolean }) {
  const cookieBanner = useCkBnnr()
  const echoImportRequested = useEchoImportRequested()
  const [simulationVisited, setSimulationVisited] = useState(simulating)
  const [echoImportVisited, setEchoImportVisited] = useState(echoImportRequested)
  if (simulating && !simulationVisited) setSimulationVisited(true)
  if (echoImportRequested && !echoImportVisited) setEchoImportVisited(true)

  return (
    <>
      {simulationVisited || echoImportVisited ? <Suspense fallback={null}><EchoImportHost /><ImportStamp />
        {simulationVisited ? <EnemyConsoleHost /> : null}</Suspense> : null}
      <NavHold />
      <DlyNtc />
      <NtfcTstCntn />
      <CookieBanner
        visible={cookieBanner.visible}
        open={cookieBanner.open}
        closing={cookieBanner.closing}
        onAccept={cookieBanner.accept}
      />
      {import.meta.env.MODE === 'beta' ? <BetaNoticeModal /> : null}
    </>
  )
}
