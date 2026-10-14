/*
  Author: Runor Ewhro
  description: measures and retains inspector leader placement across scrolling and surface transitions.
*/

interface LeaderBox {
  top: number
  left: number
  height: number
}

interface LeaderPlacement {

  noteTop: number
  /** pip position on the note edge in body coordinates */
  pipTop: number
  pipLeft: number

  shown: boolean
}

/** minimum note distance from each body edge */
const EDGE = 13
/** minimum pip distance from each note edge */
const PIP_EDGE = 14

const HEAD_SHARE = 0.28
/** the pip straddles the note's left edge. */
const STRADDLE = 1.6

export function placeLeader({
  body,
  row,
  note,
  noteHeight,
  scrollTop,
  scrollLeft,
  bodyHeight,
}: {
  body: LeaderBox
  row: LeaderBox
  note: LeaderBox
  noteHeight: number
  scrollTop: number
  scrollLeft: number
  bodyHeight: number
}): LeaderPlacement {
  const seenAt = row.top - body.top + row.height / 2
  const mid = seenAt + scrollTop
  const noteTop = Math.max(
    scrollTop + EDGE,
    Math.min(mid - noteHeight * HEAD_SHARE, scrollTop + bodyHeight - noteHeight - EDGE),
  )

  return {
    noteTop,
    pipTop: Math.max(noteTop + PIP_EDGE, Math.min(mid, noteTop + noteHeight - PIP_EDGE)),
    pipLeft: note.left - body.left + scrollLeft - STRADDLE,
    shown: seenAt > 12 && seenAt < bodyHeight - 12,
  }
}
