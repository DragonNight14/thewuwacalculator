/*
  Author: Runor Ewhro
  description: renders one context menu with entries for the clicked target.
*/

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useAppStore } from '@/application/state'
import {
  ContextMenu,
  type CtxOpenEvent,
  type MenuEntry,
  useCtxMenu,
} from '@/shared/ui/CtxMenu.tsx'
import { dialogPortal, mainPortal } from '@/shared/lib/portalTarget'
import {
  createMenuContributionRegistry,
  normalizeMenuEntries,
  type MenuContribution,
} from './menuContributions'

type AppMenuEvent = CtxOpenEvent | MouseEvent | ReactMouseEvent<Element>

interface ActiveMenu {
  ariaLabel: string
  items: MenuEntry[]
  width?: number
}

interface OpenOptions {
  ariaLabel?: string
  location?: string
  context?: unknown
  items?: MenuEntry[]
  width?: number
  onClose?: () => void
}

type MenuRegistry = ReturnType<typeof createMenuContributionRegistry>

interface AppContextMenuApi {
  enabled: boolean
  canOpen: () => boolean
  open: (event: AppMenuEvent, options: OpenOptions) => boolean
  close: () => void
  register: MenuRegistry['register']
}

const AppContext = createContext<AppContextMenuApi | null>(null)

export function AppCtxMenuPr({ children }: { children: ReactNode }) {
  const enabled = useAppStore((state) => state.ui.preferences.ctxMenu)
  const controller = useCtxMenu<ActiveMenu>()
  const [registry] = useState(createMenuContributionRegistry)
  const onCloseRef = useRef<(() => void) | null>(null)
  const active = controller.data

  useEffect(() => {
    if (!enabled) controller.close()
  }, [controller, enabled])

  useEffect(() => {
    if (controller.closing) {
      const callback = onCloseRef.current
      onCloseRef.current = null
      callback?.()
    }
  }, [controller.closing])

  const value = useMemo<AppContextMenuApi>(() => ({
    enabled,
    canOpen: () => enabled,
    close: controller.close,
    register: registry.register,
    open: (event, options) => {
      if (!enabled) return false

      const local = options.items ?? []
      const contributed = options.location
        ? registry.resolve(options.location, options.context)
        : []
      const items = normalizeMenuEntries([...local, ...contributed])
      if (items.length === 0) return false

      onCloseRef.current = options.onClose ?? null
      controller.show(event, {
        ariaLabel: options.ariaLabel ?? 'Context menu',
        items,
        width: options.width,
      })
      return true
    },
  }), [controller, enabled, registry])

  return (
    <AppContext.Provider value={value}>
      {children}
      <ContextMenu
        controller={controller}
        items={active?.items ?? []}
        portalTarget={dialogPortal() ?? mainPortal()}
        ariaLabel={active?.ariaLabel ?? 'Context menu'}
        width={active?.width}
      />
    </AppContext.Provider>
  )
}

export function useAppCtxMen(): AppContextMenuApi {
  const context = useContext(AppContext)
  if (!context) throw new Error('useAppContextMenu must be used within AppContextMenuProvider')
  return context
}

export function useMenuContributions<TContext>(
  location: string,
  contributions: MenuContribution<TContext>[],
) {
  const { register } = useAppCtxMen()
  useEffect(() => register(location, contributions), [contributions, location, register])
}
