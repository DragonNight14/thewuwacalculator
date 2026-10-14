/*
  Author: Runor Ewhro
  description: projects optimizer lifecycle, progress, candidate counts, and throughput from run state.
*/

import { useOptimizerProgress, type OptimizerProgressSource } from '../lib/progressStore'
import type { CSSProperties } from 'react'
import { formatOptimizerTime, useOptimizerWave } from '../lib/progress.ts'

export function OptStage({
  isLoading,
  progressSource,
  cancelled,
  success,
  // theory mode has no permutation count of its own until the worker reports
  // one; leave the headline slot empty until a value is available.
  permutations: inventoryPermutations,
  batchSize,
  isTheory,
  resultCount,
}: {
  isLoading: boolean
  progressSource: OptimizerProgressSource
  cancelled: boolean
  success: boolean
  permutations: string | null
  batchSize: number | null
  isTheory: boolean
  resultCount: number
}) {
  const progress = useOptimizerProgress(progressSource)
  const permutations = isTheory ? ((progress.total ?? 0) > 0 ? Math.floor(progress.total ?? 0).toLocaleString() : null) : inventoryPermutations
  const isDiscovering = isLoading && progress.phase === 'discovering'
  const pct = Math.floor(progress.progress * 100)

  const waveBars = useOptimizerWave(isLoading, progress)

  const headline = isLoading
    ? isDiscovering ? '···' : `${pct}%`
    : permutations ?? '—'

  const caption = isLoading
    ? isDiscovering
      ? 'Discovering combos'
      : Number.isFinite(progress.remainingMs)
        ? `${formatOptimizerTime(progress.remainingMs)} left`
        : 'Estimating'
    : cancelled
      ? 'Cancelled'
      : 'Permutations'

  const dash = '—'
  const cells: Array<{ key: string; value: string; live?: boolean }> = [
    ...(isTheory
      ? [{
        key: 'Discovered',
        value: progress.discovered ? progress.discovered.toLocaleString() : dash,
        live: isDiscovering,
      }]
      : []),
    {
      key: 'Processed',
      value: progress.processed ? progress.processed.toLocaleString() : dash,
      live: isLoading && !isDiscovering,
    },
    { key: 'Batch', value: batchSize ? batchSize.toLocaleString() : dash },
    { key: 'Rate', value: progress.speed ? `${progress.speed.toLocaleString()}/s` : dash },
    { key: 'Results', value: resultCount ? resultCount.toLocaleString() : dash },
  ]

  return (
    <div className="opb-stage" data-phase={isLoading ? (isDiscovering ? 'discovering' : 'running') : cancelled ? 'cancelled' : success ? 'done' : 'idle'}>
      <span className="opb-stage__sweep"
        aria-hidden="true"
        style={{ '--pct': isLoading && !isDiscovering ? `${progress.progress * 100}%` : '0%' } as CSSProperties}
      />
      <div className="opb-stage__in">
        <span className="opb-stage__big" data-none={!isLoading && permutations == null ? '' : undefined}>
          {headline}
        </span>
        <span className="opb-stage__sub">{caption}</span>

        <div className="opb-wave" data-live={isLoading ? '' : undefined} aria-hidden="true">
          {waveBars.map((height, index) => (
            <span
              key={index} className="opb-wave__bar"
              style={height > 0 ? { height: `${Math.max(10, height * 100)}%` } : undefined}
            />
          ))}
        </div>

        <div className="opb-board">
          {cells.map((cell) => (
            <span key={cell.key} className="opb-board__cell" data-live={cell.live ? '' : undefined}>
              <em>{cell.key}</em>
              <b>{cell.value}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
