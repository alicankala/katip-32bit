import { afterAll } from 'vitest'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const TEST_DIR_PREFIX = 'katip-unit-'
const tempBase = realpathSync(tmpdir())
const testRoot = realpathSync(mkdtempSync(join(tempBase, TEST_DIR_PREFIX)))

function guvenliGeciciDizinMi(candidate: string): boolean {
  const relativePath = relative(tempBase, candidate)
  return relativePath !== '' &&
    !isAbsolute(relativePath) &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    basename(candidate).startsWith(TEST_DIR_PREFIX)
}

if (!guvenliGeciciDizinMi(testRoot)) {
  throw new Error(`[KATIP_UNIT_TEMP_GUARD] Güvensiz test dizini reddedildi: ${testRoot}`)
}

process.env.KATIP_TEST_MODE = 'unit'
process.env.KATIP_TEST_ROOT = testRoot

afterAll(() => {
  if (!guvenliGeciciDizinMi(testRoot)) {
    throw new Error(`[KATIP_UNIT_TEMP_GUARD] Güvensiz silme hedefi reddedildi: ${testRoot}`)
  }

  rmSync(testRoot, { recursive: true, force: true })

  if (process.env.KATIP_TEST_ROOT === testRoot) {
    delete process.env.KATIP_TEST_ROOT
  }
  delete process.env.KATIP_TEST_MODE
})
