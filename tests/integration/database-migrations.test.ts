import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const RESULT_PREFIX = 'KATIP_INTEGRATION_RESULT:'
const CURRENT_SCHEMA_VERSION = 34

const EXPECTED_TABLES = [
  'account_payments',
  'account_transactions',
  'app_settings',
  'current_accounts',
  'customers',
  'daily_closing_reopen_logs',
  'daily_closings',
  'general_expenses',
  'masters',
  'parts',
  'phone_migrations',
  'schema_version',
  'security_config',
  'stock_movements',
  'vehicles',
  'work_order_items',
  'work_order_logs',
  'work_order_payments',
  'work_order_photos',
  'work_orders'
]

const CRITICAL_INDEXES = [
  'idx_customers_active',
  'idx_customers_phone',
  'idx_parts_code',
  'idx_vehicles_customer',
  'idx_vehicles_plate',
  'idx_work_order_items_wo',
  'idx_work_order_payments_wo',
  'idx_work_orders_status',
  'idx_work_orders_vehicle',
  'idx_stock_movements_part'
]

type IntegrationReport = Record<string, any>

const projectRoot = realpathSync(new URL('../..', import.meta.url))
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const esmRuntime = packageJson.type === 'module'
const runnerExtension = esmRuntime ? 'mjs' : 'cjs'
const runnerFormat = esmRuntime ? 'es' : 'cjs'

let freshReport: IntegrationReport
let legacyReport: IntegrationReport

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
  const bundleRoot = join(testRoot, 'electron-runner')
  mkdirSync(bundleRoot, { recursive: true })

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: join(projectRoot, 'tests/integration/electron/database-runner.ts'),
      target: 'node16',
      outDir: bundleRoot,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      rollupOptions: {
        external: [/^node:/, 'electron', 'better-sqlite3'],
        output: {
          format: runnerFormat,
          entryFileNames: `database-runner.${runnerExtension}`,
          chunkFileNames: `[name]-[hash].${runnerExtension}`
        }
      }
    }
  })

  const nodeModulesLink = join(bundleRoot, 'node_modules')
  symlinkSync(join(projectRoot, 'node_modules'), nodeModulesLink, 'junction')

  return {
    runnerPath: join(bundleRoot, `database-runner.${runnerExtension}`),
    nodeModulesLink
  }
}

async function electronCalistirilabiliriniHazirla(testRoot: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Kâtip Electron entegrasyon testleri Windows uzerinde calistirilmalidir.')
  }

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
  if (!electronVersion) {
    throw new Error('Electron surumu package.json icinden okunamadi.')
  }

  const electronRoot = join(testRoot, 'electron-host')
  mkdirSync(electronRoot, { recursive: true })
  const zipPath = await downloadArtifact({
    version: electronVersion,
    platform: 'win32',
    arch: esmRuntime ? 'x64' : 'ia32',
    artifactName: 'electron'
  })
  await extractZip(zipPath, { dir: electronRoot })

  return join(electronRoot, 'electron.exe')
}

async function senaryoCalistir(
  electronPath: string,
  runnerPath: string,
  testRoot: string,
  scenario: 'fresh' | 'legacy-v8'
): Promise<IntegrationReport> {
  const scenarioRoot = join(testRoot, scenario)
  mkdirSync(scenarioRoot, { recursive: true })

  const env = {
    ...process.env,
    KATIP_TEST_MODE: 'integration',
    KATIP_INTEGRATION_SCENARIO: scenario,
    KATIP_INTEGRATION_SCENARIO_ROOT: scenarioRoot,
    KATIP_INTEGRATION_FIXTURE: join(projectRoot, 'tests/fixtures/database/schema-v8.sql')
  }

  const { stdout } = await execFileAsync(
    electronPath,
    [`--user-data-dir=${scenarioRoot}`, runnerPath],
    { cwd: projectRoot, env, timeout: 45_000, maxBuffer: 1024 * 1024 }
  )

  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX))
  if (!resultLine) {
    throw new Error(`Electron test sonucu bulunamadi. Cikti: ${stdout}`)
  }

  return JSON.parse(resultLine.slice(RESULT_PREFIX.length))
}

beforeAll(async () => {
  const testRoot = dogrulanmisAnaTestDizini()
  const { runnerPath, nodeModulesLink } = await runnerHazirla(testRoot)
  const electronPath = await electronCalistirilabiliriniHazirla(testRoot)

  try {
    freshReport = await senaryoCalistir(electronPath, runnerPath, testRoot, 'fresh')
    legacyReport = await senaryoCalistir(electronPath, runnerPath, testRoot, 'legacy-v8')
  } finally {
    rmSync(nodeModulesLink, { recursive: true, force: true })
  }
})

describe('veritabani ve migration entegrasyonu', () => {
  it('gercek userData yerine dogrulanmis gecici test DB yolunu kullanir', () => {
    const testRoot = dogrulanmisAnaTestDizini()
    expect(freshReport.scenarioRoot.startsWith(testRoot + sep)).toBe(true)
    expect(legacyReport.scenarioRoot.startsWith(testRoot + sep)).toBe(true)
    expect(freshReport.dbPath).toBe(freshReport.expectedDbPath)
    expect(legacyReport.dbPath).toBe(legacyReport.expectedDbPath)
  })

  it('sifir veritabanindan guncel semayi kurar', () => {
    expect(freshReport.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(freshReport.tables).toEqual(expect.arrayContaining(EXPECTED_TABLES))
  })

  it('yeni veritabaninda SQLite quick_check sonucunu dogrular', () => {
    expect(freshReport.quickCheck).toBe('ok')
    expect(freshReport.quickCheckAfterSecondInit).toBe('ok')
  })

  it('foreign key denetimini etkinlestirir ve yetim kaydi reddeder', () => {
    expect(freshReport.foreignKeys).toBe(1)
    expect(freshReport.foreignKeyRejected).toBe(true)
    expect(freshReport.orphanCount).toBe(0)
  })

  it('mimariye uygun SQLite mmap bellek tavanini uygular', () => {
    expect(freshReport.mmapSize).toBe(esmRuntime ? 268435456 : 67108864)
  })

  it('kritik indeksleri olusturur', () => {
    expect(freshReport.indexes).toEqual(expect.arrayContaining(CRITICAL_INDEXES))
  })

  it('initDB ikinci kez calistiginda semayi ve veriyi degistirmez', () => {
    expect(freshReport.schemaStable).toBe(true)
    expect(freshReport.dataStable).toBe(true)
  })

  it('telefon veri normalizasyonunu yalniz bir kez isaretler', () => {
    expect(freshReport.phoneMigrationMarkerCount).toBe(1)
    expect(legacyReport.phoneMigrationMarkerCount).toBe(1)
  })

  it('v8 fixture veritabanini guncel surume migrate eder', () => {
    expect(legacyReport.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(legacyReport.tables).toEqual(expect.arrayContaining(EXPECTED_TABLES))
    expect(legacyReport.columns.masters).toEqual(expect.arrayContaining(['hidden_from_mobile', 'display_order']))
    expect(legacyReport.columns.parts).toEqual(expect.arrayContaining(['brand', 'category', 'critical_stock', 'critical_stock_enabled']))
    expect(legacyReport.columns.workOrders).toEqual(expect.arrayContaining(['opened_by_master_id', 'closed_by_master_id', 'customer_signature']))
    expect(legacyReport.columns.workOrderItems).toContain('buy_price')
  })

  it('migration sirasinda eski fixture verilerini korur', () => {
    expect(legacyReport.legacyData.customer).toMatchObject({ id: 41, name: 'Migration Fixture Customer', note: 'preserve-me' })
    expect(legacyReport.legacyData.vehicle).toMatchObject({ id: 51, customer_id: 41, plate: 'TESTV8' })
    expect(legacyReport.legacyData.part).toMatchObject({ id: 61, code: 'FIXTURE-PART', stock: 7 })
    expect(legacyReport.legacyData.workOrder).toMatchObject({ id: 71, vehicle_id: 51 })
    expect(legacyReport.legacyData.workOrderItem).toMatchObject({ id: 81, work_order_id: 71, part_id: 61 })
  })

  it('migrate edilmis DB ikinci calistirmada bozulmaz ve saglikli kalir', () => {
    expect(legacyReport.schemaStable).toBe(true)
    expect(legacyReport.dataStable).toBe(true)
    expect(legacyReport.quickCheck).toBe('ok')
    expect(legacyReport.quickCheckAfterSecondInit).toBe('ok')
    expect(legacyReport.foreignKeys).toBe(1)
    expect(legacyReport.indexes).toEqual(expect.arrayContaining(CRITICAL_INDEXES))
  })
})
