/*
  Author: Runor Ewhro
  description: resolves the worker-backed oauth endpoint paths used by browser
               google drive auth helpers.
*/

export function getGglAuthNd(path: 'exchange-code' | 'refresh-token'): string {
  return `/api/${path}`
}
