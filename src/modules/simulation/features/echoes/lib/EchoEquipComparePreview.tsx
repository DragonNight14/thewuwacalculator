/*
  Author: Runor Ewhro
  description: builds the slot-overwrite comparison payload for echo equip
               submenus without mutating the current build.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { ArrowRight } from 'lucide-react'
import { EchoCard } from '@/modules/simulation/workspace/ui.tsx'
import { makeEchoSlot } from '@/modules/simulation/workspace/echoSlot.ts'

interface EchoQpCmprPr {
  currentEcho: EchoInstance | null
  nextEcho: EchoInstance
}

export function EchoCardPreview({ echo }: { echo: EchoInstance }) {
  return (
    <div className="eep">
      <div className="eep__card">
        <EchoCard echo={makeEchoSlot(echo)} index={0} />
      </div>
    </div>
  )
}

export function EchoQpCmprdn({
  currentEcho,
  nextEcho,
}: EchoQpCmprPr) {
  return (
    <div className="eep">
      <div className="eep__lane">
        <div className="eep__card">
          <span className="eep__label">Current</span>
          <EchoCard echo={currentEcho ? makeEchoSlot(currentEcho) : null} index={0} />
        </div>
        <div className="eep__arrow" aria-hidden="true">
          <ArrowRight size="1em" />
        </div>
        <div className="eep__card">
          <span className="eep__label">Equip</span>
          <EchoCard echo={makeEchoSlot(nextEcho)} index={1} />
        </div>
      </div>
    </div>
  )
}
