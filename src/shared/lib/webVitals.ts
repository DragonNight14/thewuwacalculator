/*
  Author: Runor Ewhro
  Description: Field performance telemetry. Observes the core web vitals with
               attribution and keeps the latest values on window.__vitals for
               tuning sessions; nothing leaves the browser.
*/

import { onCLS, onINP, onLCP, type CLSMetricWithAttribution, type INPMetricWithAttribution, type LCPMetricWithAttribution } from 'web-vitals/attribution'

type VitalsMetric = CLSMetricWithAttribution | INPMetricWithAttribution | LCPMetricWithAttribution

const latest: Record<string, VitalsMetric> = {}

function metricDetail(metric: VitalsMetric): string {
  if (metric.name === 'INP') {
    return metric.attribution.interactionTarget ?? ''
  }
  if (metric.name === 'LCP') {
    return metric.attribution.target ?? ''
  }
  return metric.attribution.largestShiftTarget ?? ''
}

function record(metric: VitalsMetric) {
  latest[metric.name] = metric
  if (import.meta.env.DEV) {
    const value = metric.name === 'CLS' ? metric.value.toFixed(3) : `${Math.round(metric.value)}ms`
    const detail = metricDetail(metric)
    console.debug(`[vitals] ${metric.name} ${value} (${metric.rating})${detail ? ` · ${detail}` : ''}`)
  }
}

export function initWebVitals() {
  onCLS(record)
  onINP(record)
  onLCP(record)
  // keep the latest metrics inspectable from devtools in any environment.
  ;(window as typeof window & { __vitals?: Record<string, VitalsMetric> }).__vitals = latest
}
