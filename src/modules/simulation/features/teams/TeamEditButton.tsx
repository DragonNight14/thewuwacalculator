/*
  Author: Runor Ewhro
  description: manages the team picker and saves team selection to the active
               combat scenario.
*/

import { flushSync } from 'react-dom'
import { UserPen } from 'lucide-react'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { TeamPicker } from '@/modules/simulation/features/teams/TeamPicker.tsx'

export function TeamEditButton({
  scenarioId,
  hidden = false,
}: {
  scenarioId: CombatScenarioId | null
  /** removes an inactive duplicate from focus order and the accessibility tree. */
  hidden?: boolean
}) {
  const scenario = useAppStore((state) => (
    (scenarioId ? state.combat.scenariosById[scenarioId] : null)
    ?? selectedCombatScenario(state.combat)
  ))
  const { setTeam } = useTeamSlots({ scenarioId: scenario.id })
  const picker = useAppModal()

  return (
    <>
      <button
        type="button"
        className="pgs-seat-edit"
        aria-label="Edit team"
        aria-hidden={hidden || undefined}
        title="Edit team"
        tabIndex={hidden ? -1 : undefined}
        onClick={() => picker.show()}
      >
        <UserPen size="0.8rem" aria-hidden="true" />
      </button>

      {picker.visible ? (
        <TeamPicker
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={mainPortal()}
          leadId={scenario.team.members[0].resonatorId}
          team={scenario.team.members.map((member) => member.resonatorId)}
          onClose={() => picker.hide()}
          onCommit={(supports) => {
            // the store write renders synchronously, so commit the closing
            // phase first or the new team remounts an open picker.
            flushSync(() => picker.hide())
            setTeam(supports)
          }}
        />
      ) : null}
    </>
  )
}
