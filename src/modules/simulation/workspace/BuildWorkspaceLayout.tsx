/*
  Author: Runor Ewhro
  description: provides roster, rail, and page-column layout for build pages.
*/

import { forwardRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import type { BuildWorkspacePage } from './SimulationTools'

export const BuildWorkspaceBoard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  page: BuildWorkspacePage
}>(function BuildWorkspaceBoard({ page, className, children, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      className={['wk-board', className].filter(Boolean).join(' ')}
      data-view={page}
    >
      {children}
    </div>
  )
})

export function BuildWorkspaceWorkspace({ children }: { children: ReactNode }) {
  return <div className="wk-workspace">{children}</div>
}

export function BuildWorkspaceRailSlot({ children }: { children: ReactNode }) {
  return <div className="wk-rail-wrapper">{children}</div>
}
