import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const RESULT_PREFIX = 'KATIP_BUSINESS_RESULT:'
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
  const bundleRoot = join(testRoot, 'business-runner')
  mkdirSync(bundleRoot, { recursive: true })
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: join(projectRoot, 'tests/business/electron/business-rules-runner.ts'),
      target: 'node16',
      outDir: bundleRoot,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      rollupOptions: {
        external: [/^node:/, 'electron', 'better-sqlite3'],
        output: {
          format: runnerFormat,
          entryFileNames: `business-rules-runner.${runnerExtension}`,
          chunkFileNames: `[name]-[hash].${runnerExtension}`
        }
      }
    }
  })

  const nodeModulesLink = join(bundleRoot, 'node_modules')
  symlinkSync(join(projectRoot, 'node_modules'), nodeModulesLink, 'junction')
  return { runnerPath: join(bundleRoot, `business-rules-runner.${runnerExtension}`), nodeModulesLink }
}

async function electronCalistirilabiliriniHazirla(testRoot: string): Promise<{ electronPath: string, electronRoot: string }> {
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
  if (!electronVersion) throw new Error('Electron surumu package.json icinden okunamadi.')

  const electronRoot = join(testRoot, 'business-electron-host')
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
  const scenarioRoot = join(testRoot, 'business-rules')
  mkdirSync(scenarioRoot, { recursive: true })
  const { runnerPath, nodeModulesLink } = await runnerHazirla(testRoot)
  const { electronPath, electronRoot } = await electronCalistirilabiliriniHazirla(testRoot)

  try {
    const { stdout } = await execFileAsync(
      electronPath,
      [`--user-data-dir=${scenarioRoot}`, runnerPath],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          KATIP_TEST_MODE: 'integration',
          KATIP_BUSINESS_SCENARIO_ROOT: scenarioRoot
        },
        timeout: 75_000,
        maxBuffer: 2 * 1024 * 1024
      }
    )
    const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX))
    if (!resultLine) throw new Error(`Electron test sonucu bulunamadi. Cikti: ${stdout}`)
    report = JSON.parse(resultLine.slice(RESULT_PREFIX.length))
  } finally {
    rmSync(nodeModulesLink, { recursive: true, force: true })
    rmSync(electronRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
  }
})

describe('para, stok ve iş emri controller iş kuralları', () => {
  it('yalnız doğrulanmış geçici userData ve test DB yolunu kullanır', () => {
    const testRoot = dogrulanmisAnaTestDizini()
    expect(report.safety.scenarioRoot.startsWith(testRoot + sep)).toBe(true)
    expect(report.safety.dbPath).toBe(report.safety.expectedDbPath)
  })

  it('stoklu parça eklenince stok düşer ve çıkış hareketi kaydedilir', () => {
    expect(report.stockAdd.result.success).toBe(true)
    expect(report.stockAdd.stock).toBe(8)
    expect(report.stockAdd.item).toMatchObject({ quantity: 2, total_price: 100 })
    expect(report.stockAdd.order.total_price).toBe(100)
    expect(report.stockAdd.movements).toHaveLength(1)
    expect(report.stockAdd.movements[0]).toMatchObject({ type: 'Çıkış', quantity: 2, old_stock: 10, new_stock: 8 })
  })

  it('parça miktarı artırılınca yalnız fark kadar stok düşer', () => {
    expect(report.stockIncrease.result.success).toBe(true)
    expect(report.stockIncrease.stock).toBe(5)
    expect(report.stockIncrease.item).toMatchObject({ quantity: 5, total_price: 250 })
    expect(report.stockIncrease.order.total_price).toBe(250)
    expect(report.stockIncrease.movements[1]).toMatchObject({ type: 'Çıkış', quantity: 3, old_stock: 8, new_stock: 5 })
  })

  it('parça miktarı azaltılınca fark kadar stok geri gelir', () => {
    expect(report.stockDecrease.result.success).toBe(true)
    expect(report.stockDecrease.stock).toBe(7)
    expect(report.stockDecrease.item).toMatchObject({ quantity: 3, total_price: 150 })
    expect(report.stockDecrease.order.total_price).toBe(150)
    expect(report.stockDecrease.movements[2]).toMatchObject({ type: 'Giriş', quantity: 2, old_stock: 5, new_stock: 7 })
  })

  it('iş emri kalemi silinince stok iade edilir ve toplam güncellenir', () => {
    expect(report.stockDelete.result.success).toBe(true)
    expect(report.stockDelete.stock).toBe(10)
    expect(report.stockDelete.itemCount).toBe(0)
    expect(report.stockDelete.order.total_price).toBe(0)
    expect(report.stockDelete.movements[3]).toMatchObject({ type: 'Giriş', quantity: 3, old_stock: 7, new_stock: 10 })
    expect(report.stockDelete.logCount).toBe(0)
  })

  it('iş emri iptalinde mevcut stok, kalem ve hareket kayıtları tutarlı kalır', () => {
    expect(report.orderCancellation.result.success).toBe(true)
    expect(report.orderCancellation.order).toMatchObject({ status: 'İptal', total_price: 80, closed_at: null, closed_by_master_id: null })
    expect(report.orderCancellation.stock).toBe(4)
    expect(report.orderCancellation.item).toMatchObject({ quantity: 2, total_price: 80 })
    expect(report.orderCancellation.movementCountAfter).toBe(report.orderCancellation.movementCountBefore)
    expect(report.orderCancellation.logCount).toBe(0)
  })

  it('tahsilatı doğru alanlar ve aktif toplamla kaydeder', () => {
    expect(report.paymentAdd.result.success).toBe(true)
    expect(report.paymentAdd.payment).toMatchObject({ amount: 60, payment_method: 'Nakit', payment_date: '2024-01-10', is_cancelled: 0 })
    expect(report.paymentAdd.activeTotal).toBe(60)
    expect(report.paymentAdd.order.total_price).toBe(100)
    expect(report.paymentAdd.logCount).toBe(0)
  })

  it('ödeme iptalini fiziksel silmeden gerekçe ve yapan usta ile saklar', () => {
    expect(report.paymentCancel.result.success).toBe(true)
    expect(report.paymentCancel.payment).toMatchObject({ is_cancelled: 1, cancel_reason: 'Yanlış tahsilat kaydı' })
    expect(report.paymentCancel.payment.cancelled_by).toBeGreaterThan(0)
    expect(report.paymentCancel.payment.cancelled_at).toBeTruthy()
    expect(report.paymentCancel.activeTotal).toBe(0)
    expect(report.paymentCancel.paymentCount).toBe(1)
    expect(report.paymentCancel.logCount).toBe(0)
  })

  it('tahsilat altına toplam düşürme girişimini ve kalem güncellemesini rollback eder', () => {
    expect(report.paymentFloor.result.success).toBe(false)
    expect(report.paymentFloor.item).toMatchObject({ quantity: 1, unit_price: 100, total_price: 100 })
    expect(report.paymentFloor.order).toMatchObject({ status: 'Açık', total_price: 100 })
    expect(report.paymentFloor.payments).toEqual([{ amount: 80, is_cancelled: 0 }])
    expect(report.paymentFloor.movementCount).toBe(0)
    expect(report.paymentFloor.logCount).toBe(0)
  })

  it('iş emri tamamlama ve ödeme kaydını atomik olarak uygular', () => {
    expect(report.atomicSuccess.result.success).toBe(true)
    expect(report.atomicSuccess.order.status).toBe('Tamamlandı')
    expect(report.atomicSuccess.order.closed_at).toBeTruthy()
    expect(report.atomicSuccess.order.closed_by_master_id).toBeGreaterThan(0)
    expect(report.atomicSuccess.payments).toEqual([
      expect.objectContaining({ amount: 40, payment_method: 'Havale / EFT', payment_date: '2024-01-12' })
    ])
    expect(report.atomicSuccess.logCount).toBe(0)
  })

  it('ödeme insert hatasında tamamlanma dahil tüm transactionı rollback eder', () => {
    expect(report.atomicRollback.result.success).toBe(false)
    expect(report.atomicRollback.order).toMatchObject({ status: 'Açık', total_price: 90, closed_at: null, closed_by_master_id: null })
    expect(report.atomicRollback.paymentCount).toBe(0)
    expect(report.atomicRollback.itemCount).toBe(1)
    expect(report.atomicRollback.logCount).toBe(0)
  })

  it('kalem insert hatasında stok ve stok hareketini rollback eder', () => {
    expect(report.stockRollback.result.success).toBe(false)
    expect(report.stockRollback.stock).toBe(5)
    expect(report.stockRollback.itemCount).toBe(0)
    expect(report.stockRollback.movementCount).toBe(0)
    expect(report.stockRollback.order).toMatchObject({ status: 'Açık', total_price: 0 })
    expect(report.stockRollback.logCount).toBe(0)
  })

  it('gün sonu nakit, kart ve havale tahsilatlarını doğru toplar', () => {
    const summary = report.dailySummary.result.ozet
    expect(report.dailySummary.result.success).toBe(true)
    expect(summary.toplamTahsilat).toBe(205)
    expect(summary.yontemTahsilat).toEqual({ nakit: 130, kart: 50, havale: 25, diger: 0 })
    expect(summary.beklenenNakit).toBe(115)
    expect(report.dailySummary.activeWorkOrderTotal).toBe(175)
  })

  it('iptal edilen ödeme gün sonuna dahil edilmez ve denetim kaydı korunur', () => {
    expect(report.dailySummary.cancelledResult.success).toBe(true)
    expect(report.dailySummary.cancelledWorkOrderTotal).toBe(40)
    const cancelled = report.dailySummary.workOrderPayments.find((payment: any) => payment.is_cancelled === 1)
    expect(cancelled).toMatchObject({ amount: 40, cancel_reason: 'Gün sonu dışlama kontrolü' })
    expect(report.dailySummary.result.ozet.toplamTahsilat).toBe(205)
  })

  it('cari yönleri ve giderleri doğru para giriş/çıkışına yansıtır', () => {
    const summary = report.dailySummary.result.ozet
    expect(Object.values(report.dailySummary.accountResults).every((result: any) => result.success)).toBe(true)
    expect(report.dailySummary.expenseResult.success).toBe(true)
    expect(report.dailySummary.accountPayments).toEqual([
      expect.objectContaining({ amount: 30, direction: 'Alacak' }),
      expect.objectContaining({ amount: 20, direction: 'Borç' })
    ])
    expect(summary.toplamCikis).toBe(35)
    expect(summary.yontemCikis).toEqual({ nakit: 15, kart: 20, havale: 0, diger: 0 })
  })

  it('ana panel borç özetini tüm açık carilerden hesaplayıp yalnız en yüksek üçünü döndürür', () => {
    expect(report.dashboardDebts.accountResults.every((item: any) => item.account.success && item.transaction.success)).toBe(true)
    expect(report.dashboardDebts.paymentResult.success).toBe(true)
    expect(report.dashboardDebts.result).toMatchObject({
      success: true,
      totalDebt: 990,
      openAccountCount: 4
    })
    expect(report.dashboardDebts.result.debts).toHaveLength(3)
    expect(report.dashboardDebts.result.debts.map((item: any) => item.remaining_debt)).toEqual([400, 300, 200])
  })

  it('kapalı güne ödeme, ödeme iptali, cari ödeme ve gider ekletmez', () => {
    expect(report.closedDay.closeResult.success).toBe(true)
    expect(Object.values(report.closedDay.results).every((result: any) => result.success === false)).toBe(true)
    expect(report.closedDay.afterCounts).toEqual(report.closedDay.beforeCounts)
    expect(report.closedDay.payment).toMatchObject({ is_cancelled: 0, cancelled_at: null, cancel_reason: null })
    expect(report.closedDay.closing.closing_date).toBe('2024-01-16')
    expect(report.closedDay.logCount).toBe(0)
  })

  it('iş kuralları sonrasında SQLite quick_check sağlıklıdır', () => {
    expect(report.quickCheck).toBe('ok')
  })
})
