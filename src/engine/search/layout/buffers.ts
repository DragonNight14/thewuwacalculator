/*
  Author: Runor Ewhro
  description: discovers transferable numeric buffers and promotes aliased typed
               array views into shared storage without losing offsets or lengths.
*/

const NUMERIC_RECORD_KEYS = new Set(['rotationProgram', 'weaponPrograms', 'scalar', 'displayScalar'])
/** visit numeric payload records without traversing cold catalogs/scenarios. */
function numericRecords(payload: object): object[] {
  const pending = [payload], records: object[] = []
  const seen = new Set<object>()
  while (pending.length) {
    const record = pending.pop()!
    if (seen.has(record)) continue
    seen.add(record); records.push(record)
    if (Array.isArray(record)) { for (const value of record) if (value && typeof value === 'object') pending.push(value); continue }
    for (const [key, value] of Object.entries(record)) if (NUMERIC_RECORD_KEYS.has(key) && value && typeof value === 'object') pending.push(value)
  }
  return records
}

/** flat vectors and nested native-program vectors share the same transfer rule. */
export function payloadTransfers(payload: object): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const record of numericRecords(payload)) for (const value of Object.values(record)) {
    if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer)
  }
  return [...buffers]
}

export function sharePayload<T extends object>(payload: T): T {
  if (typeof SharedArrayBuffer === 'undefined') return payload
  const shared = new Map<ArrayBuffer, SharedArrayBuffer>()
  for (const record of numericRecords(payload)) for (const [key, value] of Object.entries(record)) {
    if (!ArrayBuffer.isView(value) || !(value.buffer instanceof ArrayBuffer)) continue
    let buffer = shared.get(value.buffer)
    if (!buffer) {
      buffer = new SharedArrayBuffer(value.buffer.byteLength)
      new Uint8Array(buffer).set(new Uint8Array(value.buffer))
      shared.set(value.buffer, buffer)
    }
    const Ctor = value.constructor as new (buffer: SharedArrayBuffer, offset: number, length: number) => ArrayBufferView
    // all optimizer views are numeric typed arrays, never DataView.
    const view = value as ArrayBufferView & { length: number }
    Object.assign(record, { [key]: new Ctor(buffer, view.byteOffset, view.length) })
  }
  return payload
}

/** allocate final compiler output directly in shareable storage when supported. */
export function optimizerFloats(source: number | ArrayLike<number>): Float32Array {
  const length = typeof source === 'number' ? source : source.length
  const result = typeof SharedArrayBuffer === 'undefined'
    ? new Float32Array(length)
    : new Float32Array(new SharedArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT))
  if (typeof source !== 'number') result.set(source)
  return result
}
