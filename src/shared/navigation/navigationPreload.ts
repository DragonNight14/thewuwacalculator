/*
  Author: Runor Ewhro
  description: defines the navigation preload contract so links can preload
               chunks without importing application route modules.
*/

interface NavigationPreloader {
  warmPath: (pathname: string) => Promise<void>
  isPathWarm: (pathname: string) => boolean
}

let preloader: NavigationPreloader = {
  warmPath: () => Promise.resolve(),
  isPathWarm: () => false,
}

export function configureNavigationPreloader(next: NavigationPreloader): void {
  preloader = next
}

export function warmNavigationPath(pathname: string): Promise<void> {
  return preloader.warmPath(pathname)
}

export function isNavigationPathWarm(pathname: string): boolean {
  return preloader.isPathWarm(pathname)
}
