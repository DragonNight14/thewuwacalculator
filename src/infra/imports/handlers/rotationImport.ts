/*
  Author: Runor Ewhro
  Description: Registers rotation exports with the import surface, normalizing
               all supported payload shapes before save/load decisions run.
*/

import { useMemo } from 'react'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  normMprtRotEntries,
  type NormMprtRot,
} from '@/modules/calculator/features/rotation/lib/savedRotations.ts'
import { useApplyImportedRot } from '@/modules/calculator/features/rotation/lib/useApplyImportedRot.ts'
import type { ImportHandler } from '@/infra/imports/types.ts'

export const ROTATION_IMPORT_KIND = 'rotation'

export function useRotationImportHandler(): ImportHandler<NormMprtRot[]> {
  const addRotToInv = useAppStore((state) => state.addInvRot)
  const applyImportedRot = useApplyImportedRot()
  const showToast = useTstStr((state) => state.show)

  return useMemo<ImportHandler<NormMprtRot[]>>(() => ({
    kind: ROTATION_IMPORT_KIND,
    detect: (parsed) => {
      const entries = normMprtRotEntries(parsed)
      return entries.length > 0 ? entries : null
    },
    review: (entries) => {
      const single = entries.length === 1 ? entries[0] : null
      return {
        title: single ? 'Import rotation' : 'Import rotations',
        summary: single
          ? `Add "${single.name}" (${single.resName}) to your saved rotations.`
          : `Add ${entries.length} rotations to your saved rotations.`,
        primaryLabel: 'Import & load',
        secondaryLabel: 'Import only',
      }
    },
    apply: (entries, variant) => {
      const added: InvRotEnt[] = []
      for (const entry of entries) {
        const addedEntry = addRotToInv({ ...entry, resonatorName: entry.resName })
        if (addedEntry) added.push(addedEntry)
      }

      const first = added[0]
      if (!first) {
        showToast({
          content: 'No valid rotation data found.',
          variant: 'error',
          duration: 3500,
        })
        return
      }

      if (variant === 'primary') {
        applyImportedRot(first)
        showToast({
          content: `Imported and loaded "${first.name}".`,
          variant: 'success',
          duration: 3000,
        })
        return
      }

      showToast({
        content: `Imported ${added.length} rotation${added.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    },
  }), [addRotToInv, applyImportedRot, showToast])
}
