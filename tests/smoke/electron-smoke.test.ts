import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const RESULT_PREFIX = 'KATIP_SMOKE_RESULT:'
const projectRoot = realpathSync(new URL('../..', import.meta.url))
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const esmRuntime = packageJson.type === 'module'
const runnerExtension = esmRuntime ? 'mjs' : 'cjs'
const runnerFormat = esmRuntime ? 'es' : 'cjs'

let report: Record<string, any>

function dogrulanmisAnaTestDizini(): string {
  const candidate = process.env.KATIP_INTEGRATION_TEST_ROOT
  expect(process.env.KATIP_TEST_MODE).toBe('integration')
  expect(candidate).toBeTruthy()
  const tempBase = realpathSync(tmpdir())
  const resolvedRoot = realpathSync(candidate!)
  const relativePath = relative(tempBase, resolvedRoot)
  expect(relativePath).not.toBe('')
  expect(isAbsolute(relativePath)).toBe(false)
  expect(relativePath).not.toBe('..')
  expect(relativePath.startsWith(`..${sep}`)).toBe(false)
  expect(basename(resolvedRoot).startsWith('katip-integration-')).toBe(true)
  return resolvedRoot
}

async function runnerHazirla(testRoot: string): Promise<{ runnerPath: string, nodeModulesLink: string }> {
  const bundleRoot = join(testRoot, 'smoke-runner')
  mkdirSync(bundleRoot, { recursive: true })
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: join(projectRoot, 'tests/smoke/electron/smoke-runner.ts'),
      target: 'node16',
      outDir: bundleRoot,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      rollupOptions: {
        external: [/^node:/, 'electron', 'better-sqlite3'],
        output: {
          format: runnerFormat,
          entryFileNames: `smoke-runner.${runnerExtension}`,
          chunkFileNames: `[name]-[hash].${runnerExtension}`
        }
      }
    }
  })
  const nodeModulesLink = join(bundleRoot, 'node_modules')
  symlinkSync(join(projectRoot, 'node_modules'), nodeModulesLink, 'junction')
  return { runnerPath: join(bundleRoot, `smoke-runner.${runnerExtension}`), nodeModulesLink }
}

async function electronHazirla(testRoot: string): Promise<{ electronPath: string, electronRoot: string }> {
  if (process.platform !== 'win32') throw new Error('Electron smoke testi Windows üzerinde çalıştırılmalıdır.')
  const nodeRequire = createRequire(import.meta.url)
  const { downloadArtifact } = nodeRequire('@electron/get') as {
    downloadArtifact: (options: Record<string, string>) => Promise<string>
  }
  let extractZip: (zipPath: string, options: { dir: string }) => Promise<void>
  try {
    extractZip = nodeRequire('@electron-internal/extract-zip').extract
  } catch {
    extractZip = nodeRequire('extract-zip')
  }
  const electronVersion = String(packageJson.devDependencies.electron).match(/\d+\.\d+\.\d+/)?.[0]
  if (!electronVersion) throw new Error('Electron sürümü package.json içinden okunamadı.')
  const electronRoot = join(testRoot, 'smoke-electron-host')
  mkdirSync(electronRoot, { recursive: true })
  const zipPath = await downloadArtifact({
    version: electronVersion,
    platform: 'win32',
    arch: esmRuntime ? 'x64' : 'ia32',
    artifactName: 'electron'
  })
  await extractZip(zipPath, { dir: electronRoot })
  return { electronPath: join(electronRoot, 'electron.exe'), electronRoot }
}

beforeAll(async () => {
  const testRoot = dogrulanmisAnaTestDizini()
  const scenarioRoot = join(testRoot, 'smoke-scenario')
  mkdirSync(scenarioRoot, { recursive: true })
  const expectedPreload = join(projectRoot, 'dist-electron', esmRuntime ? 'preload.mjs' : 'preload.js')
  expect(existsSync(join(projectRoot, 'dist', 'index.html'))).toBe(true)
  expect(existsSync(expectedPreload)).toBe(true)
  const { runnerPath, nodeModulesLink } = await runnerHazirla(testRoot)
  const { electronPath, electronRoot } = await electronHazirla(testRoot)
  try {
    let stdout = ''
    let stderr = ''
    try {
      const result = await execFileAsync(
        electronPath,
        ['--disable-gpu', `--user-data-dir=${scenarioRoot}`, runnerPath],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            KATIP_TEST_MODE: 'integration',
            KATIP_SMOKE_SCENARIO_ROOT: scenarioRoot
          },
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024
        }
      )
      stdout = result.stdout
      stderr = result.stderr
    } catch (error: any) {
      throw new Error(`Electron smoke child başarısız. stdout: ${error?.stdout || ''}\nstderr: ${error?.stderr || error?.message || error}`)
    }
    const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX))
    if (!resultLine) throw new Error(`Electron smoke sonucu bulunamadı. stdout: ${stdout}\nstderr: ${stderr}`)
    report = JSON.parse(resultLine.slice(RESULT_PREFIX.length))
  } finally {
    rmSync(nodeModulesLink, { recursive: true, force: true })
    try {
      rmSync(electronRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
    } catch {
      // Child timeout'unda Electron yardimci surecleri DLL'i kisa sure daha
      // tutabilir; dogrulanmis ortak temp kokunun afterAll temizligi yeniden dener.
    }
  }
})

describe('Electron kritik akış smoke testi', () => {
  it('yalnız doğrulanmış geçici userData ve SQLite kullanır', () => {
    const testRoot = dogrulanmisAnaTestDizini()
    expect(report.safety.scenarioRoot.startsWith(testRoot + sep)).toBe(true)
    expect(report.safety.tempPath.startsWith(report.safety.scenarioRoot + sep)).toBe(true)
    expect(report.safety.dbPath).toBe(report.safety.expectedDbPath)
  })

  it('doğru mimari Electron ve preload çıktısıyla uygulamayı açar', () => {
    expect(report.runtime.arch).toBe(esmRuntime ? 'x64' : 'ia32')
    expect(report.runtime.electron).toBe(String(packageJson.devDependencies.electron).match(/\d+\.\d+\.\d+/)?.[0])
    expect(report.runtime.preloadFile).toBe(esmRuntime ? 'preload.mjs' : 'preload.js')
    expect(report.loginScreen).toBe(true)
    expect(report.initialTheme).toBe('light')
  })

  it('yerel yazdırma penceresini güvenli tercihlerle açıp uzak pencereyi reddeder', () => {
    expect(report.printing.printOpenReturnedWindow).toBe(true)
    expect(report.printing.printWindowState).toMatchObject({
      title: 'Katip Print Smoke',
      text: 'print-ready',
      hasNodeRequire: false,
      hasNodeProcess: false
    })
    expect(report.printing.deniedOpenReturnedWindow).toBe(false)
    expect(report.printing.remoteWindowDenied).toBe(true)
  })

  it('contextBridge API ve temel IPC bağlantısını doğrular', () => {
    expect(report.preloadState).toEqual({
      hasApi: true,
      hasLogin: true,
      hasCustomer: true,
      hasWorkOrder: true
    })
    expect(report.mastersResult.success).toBe(true)
    expect(report.mastersResult.ustalar.length).toBeGreaterThan(0)
  })

  it('giriş ekranından gerçek usta oturumu açar', () => {
    expect(report.loggedIn).toBe(true)
  })

  it('geçici müşteri, araç ve iş emri zincirini IPC üzerinden tamamlayıp ekranı açar', () => {
    expect(report.chainResult.success).toBe(true)
    expect(Array.isArray(report.chainResult.orders)).toBe(true)
    expect(report.chainResult.orders.length).toBeGreaterThan(0)
    expect(report.persisted.customer.name).toBe('Smoke Customer')
    expect(report.persisted.vehicle.plate).toBe('SMK5001')
    expect(report.persisted.workOrder).toMatchObject({
      description: 'Smoke work order',
      status: 'Açık'
    })
    expect(report.persisted.vehicle.customer_id).toBe(report.persisted.customer.id)
    expect(report.persisted.workOrder.vehicle_id).toBe(report.persisted.vehicle.id)
    expect(report.workOrdersScreen).toBe(true)
  })

  it('SQLite sağlıklı kalırken pencereyi temiz kapatır', () => {
    expect(report.quickCheck).toBe('ok')
    expect(report.closedCleanly).toBe(true)
  })
})
