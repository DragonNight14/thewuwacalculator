/*
  Author: Runor Ewhro
  description: generates the compact shell notice from the authored changelog.
*/

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import type { ChngRcrd } from '../../src/data/content/changelogEntries.ts'

const sourceFile = fileURLToPath(new URL('../../src/data/content/changelogEntries.ts', import.meta.url))
const outputFile = fileURLToPath(new URL('../../src/data/content/currentChangelogNotice.generated.json', import.meta.url))

export function createChangelogNotice(entries: ChngRcrd[]) {
  const latest = entries.at(-1)
  if (!latest?.id?.trim()) throw new Error('The latest changelog entry needs a stable id.')
  if (entries.filter((entry) => entry.id === latest.id).length !== 1) {
    throw new Error(`Duplicate changelog id: ${latest.id}`)
  }
  const shortDesc = latest.shortDesc ?? latest.entries[0]?.content
  if (!shortDesc?.trim()) throw new Error('The latest changelog entry needs a summary.')
  return {
    id: latest.id,
    date: latest.date,
    ...(latest.patchVersion ? { patchVersion: latest.patchVersion } : {}),
    shortDesc,
  }
}

export async function buildChangelogNotice(options: { sourceFile?: string; outputFile?: string } = {}) {
  // Reload authored data after dev edits instead of retaining Node's module cache.
  const source = pathToFileURL(options.sourceFile ?? sourceFile)
  const revision = createHash('sha256').update(await readFile(source)).digest('hex')
  source.searchParams.set('notice', revision)
  const { curChngEnts } = await import(/* @vite-ignore */ source.href) as typeof import('../../src/data/content/changelogEntries.ts')
  const notice = createChangelogNotice(curChngEnts)
  const output = `${JSON.stringify(notice, null, 2)}\n`
  const target = options.outputFile ?? outputFile
  const previous = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (previous !== output) await writeFile(target, output)
  return notice
}

export function changelogNoticePlugin(): Plugin {
  return {
    name: 'changelog-notice',
    async buildStart() {
      this.addWatchFile(sourceFile)
      await buildChangelogNotice()
    },
    async handleHotUpdate({ file }) {
      if (file === sourceFile) await buildChangelogNotice()
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildChangelogNotice()
