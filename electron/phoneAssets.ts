import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const primeiconsAssetCache = new Map<string, Buffer>()

export const PRIMEICONS_FONT_CONTENT_TYPES: Record<string, string> = {
  '.eot': 'application/vnd.ms-fontobject',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml'
}

export async function primeiconsAssetOku(relativePath: string): Promise<Buffer | null> {
  const cached = primeiconsAssetCache.get(relativePath)
  if (cached) return cached
  try {
    const fullPath = path.join(app.getAppPath(), 'node_modules', 'primeicons', relativePath)
    const data = await fs.readFile(fullPath)
    primeiconsAssetCache.set(relativePath, data)
    return data
  } catch {
    return null
  }
}
