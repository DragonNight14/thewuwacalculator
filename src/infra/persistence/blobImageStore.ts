/*
  Author: Runor Ewhro
  description: small indexeddb-backed blob store used for image snapshots and
               other local binary persistence needs.
*/

const DB_NAME = 'WuWaCalculatorImageStore'
const STORE_NAME = 'images'
const SURFACE_STORE_NAME = 'surfaces'
const DB_VERSION = 2

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    let blocked = false
    request.onblocked = () => {
      blocked = true
      reject(new Error('Image storage upgrade is blocked by another tab.'))
    }

    request.onupgradeneeded = () => {
      // preserve existing image blobs when adding derived surface metadata.
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
      if (!database.objectStoreNames.contains(SURFACE_STORE_NAME)) {
        database.createObjectStore(SURFACE_STORE_NAME)
      }
    }

    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

// stores an image blob under a stable key for later reuse.
export async function saveMgBlob(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.put(blob, key)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
    transaction.onabort = () => { database.close(); reject(transaction.error) }
  })
}

// loads an image blob by key and returns null when no cached entry exists.
export async function loadMgBlob(key: string): Promise<Blob | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(key)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => database.close()
    transaction.onabort = () => { database.close(); reject(transaction.error) }
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function loadImageSurface(key: string): Promise<string | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SURFACE_STORE_NAME, 'readonly')
    const request = transaction.objectStore(SURFACE_STORE_NAME).get(key)
    request.onsuccess = () => resolve(
      typeof request.result === 'string' && /^#[0-9a-f]{6}$/i.test(request.result) ? request.result : null,
    )
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => database.close()
    transaction.onabort = () => { database.close(); reject(transaction.error) }
  })
}

export async function saveImageSurface(key: string, color: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SURFACE_STORE_NAME, 'readwrite')
    transaction.objectStore(SURFACE_STORE_NAME).put(color, key)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
    transaction.onabort = () => { database.close(); reject(transaction.error) }
  })
}
