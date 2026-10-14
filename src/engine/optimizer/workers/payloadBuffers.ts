/*
  Author: Runor Ewhro
  description: discovers transferable numeric buffers and promotes aliased typed
               array views into shared storage without losing offsets or lengths.
*/

/** numeric payload fields are top-level, including optional weapon fields. */
export function payloadTransfers(payload: object): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const value of Object.values(payload)) {
    if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer)
  }
  return [...buffers]
}

export function sharePayload<T extends object>(payload: T): T {
  if (typeof SharedArrayBuffer === 'undefined') return payload
  const shared = new Map<ArrayBuffer, SharedArrayBuffer>()
  for (const [key, value] of Object.entries(payload)) {
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
    Object.assign(payload, { [key]: new Ctor(buffer, view.byteOffset, view.length) })
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
