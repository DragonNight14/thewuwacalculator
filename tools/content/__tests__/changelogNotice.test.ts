import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildChangelogNotice, createChangelogNotice } from '../buildChangelogNotice'

const entry = { id: 'release-a', date: '24/10/2026', shortDesc: 'Release A', entries: [] }

describe('changelog notice generation', () => {
  it('keeps dismissal identity when the latest entry is corrected', () => {
    const previous = { ...entry, id: 'release-previous' }
    const original = createChangelogNotice([previous, entry])
    const corrected = createChangelogNotice([previous, { ...entry, date: '23/10/2026', shortDesc: 'Corrected copy' }])
    expect(corrected.id).toBe(original.id)
    expect(corrected.shortDesc).toBe('Corrected copy')
    expect(createChangelogNotice([entry, { ...entry, id: 'release-next' }]).id).not.toBe(original.id)
  })

  it('rejects missing or reused release IDs instead of silently reusing a dismissal', () => {
    expect(() => createChangelogNotice([])).toThrow('stable id')
    expect(() => createChangelogNotice([{ ...entry, id: undefined }])).toThrow('stable id')
    expect(() => createChangelogNotice([entry, { ...entry }])).toThrow('Duplicate changelog id')
  })

  it('uses the first paragraph for entries without a short summary and rejects empty notices', () => {
    expect(createChangelogNotice([{ ...entry, shortDesc: undefined, entries: [{ type: 'paragraph', content: '<strong>New release</strong>' }] }]).shortDesc)
      .toBe('<strong>New release</strong>')
    expect(() => createChangelogNotice([{ ...entry, shortDesc: undefined }])).toThrow('needs a summary')
  })

  it('reloads authored changes and avoids rewriting an unchanged artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wuwa-changelog-'))
    const sourceFile = join(root, 'changelog.mjs')
    const outputFile = join(root, 'notice.json')
    const writeEntries = (shortDesc: string) => writeFile(sourceFile,
      `export const curChngEnts = ${JSON.stringify([{ ...entry, shortDesc }])}\n`)
    try {
      await writeEntries('First copy')
      await buildChangelogNotice({ sourceFile, outputFile })
      const original = await stat(outputFile)
      await buildChangelogNotice({ sourceFile, outputFile })
      expect((await stat(outputFile)).mtimeMs).toBe(original.mtimeMs)
      await writeEntries('Edited copy')
      await buildChangelogNotice({ sourceFile, outputFile })
      expect(JSON.parse(await readFile(outputFile, 'utf8'))).toMatchObject({ id: entry.id, shortDesc: 'Edited copy' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
