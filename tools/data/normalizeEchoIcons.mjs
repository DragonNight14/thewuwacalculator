/* keep one full-resolution, genuinely webp icon for display and card matching. */
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const defaultIconDir = fileURLToPath(new URL('../../public/assets/game/echoes/icons/', import.meta.url))

export async function normalizeEchoIcons(iconDir = defaultIconDir) {
  let converted = 0
  for (const entry of await readdir(iconDir, { withFileTypes: true })) {
    const file = join(iconDir, entry.name)
    if (entry.isDirectory()) {
      converted += await normalizeEchoIcons(file)
      continue
    }
    if (!entry.name.endsWith('.webp')) continue
    const bytes = await readFile(file)
    const metadata = await sharp(bytes).metadata()
    if (metadata.format === 'webp') continue
    const encoded = await sharp(bytes).webp({ lossless: true, effort: 6 }).toBuffer()
    await writeFile(`${file}.tmp`, encoded)
    await rename(`${file}.tmp`, file)
    converted += 1
  }
  return converted
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`echo icons: ${await normalizeEchoIcons()} converted to lossless WebP`)
}
