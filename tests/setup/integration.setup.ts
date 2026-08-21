import { afterAll } from 'vitest'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const TEST_DIR_PREFIX = 'katip-integration-'
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
  throw new Error(`[KATIP_INTEGRATION_TEMP_GUARD] Guvensiz test dizini reddedildi: ${testRoot}`)
}

process.env.KATIP_TEST_MODE = 'integration'
process.env.KATIP_INTEGRATION_TEST_ROOT = testRoot

afterAll(() => {
  if (!guvenliGeciciDizinMi(testRoot)) {
    throw new Error(`[KATIP_INTEGRATION_TEMP_GUARD] Guvensiz silme hedefi reddedildi: ${testRoot}`)
  }

  rmSync(testRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })

  if (process.env.KATIP_INTEGRATION_TEST_ROOT === testRoot) {
    delete process.env.KATIP_INTEGRATION_TEST_ROOT
  }
  delete process.env.KATIP_TEST_MODE
})
