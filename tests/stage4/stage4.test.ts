import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const RESULT_PREFIX = 'KATIP_STAGE4_RESULT:'
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
  const bundleRoot = join(testRoot, 'stage4-runner')
  mkdirSync(bundleRoot, { recursive: true })
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: join(projectRoot, 'tests/stage4/electron/stage4-runner.ts'),
      target: 'node16',
      outDir: bundleRoot,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      rollupOptions: {
        external: [/^node:/, 'electron', 'better-sqlite3', 'yazl', 'yauzl'],
        output: {
          format: runnerFormat,
          entryFileNames: `stage4-runner.${runnerExtension}`,
          chunkFileNames: `[name]-[hash].${runnerExtension}`
        }
      }
    }
  })
  const nodeModulesLink = join(bundleRoot, 'node_modules')
  symlinkSync(join(projectRoot, 'node_modules'), nodeModulesLink, 'junction')
  return { runnerPath: join(bundleRoot, `stage4-runner.${runnerExtension}`), nodeModulesLink }
}

async function electronHazirla(testRoot: string): Promise<{ electronPath: string, electronRoot: string }> {
  if (process.platform !== 'win32') throw new Error('Aşama 4 Electron testleri Windows üzerinde çalıştırılmalıdır.')
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
  const electronRoot = join(testRoot, 'stage4-electron-host')
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
  const scenarioRoot = join(testRoot, 'stage4-scenario')
  mkdirSync(scenarioRoot, { recursive: true })
  const { runnerPath, nodeModulesLink } = await runnerHazirla(testRoot)
  const { electronPath, electronRoot } = await electronHazirla(testRoot)
  try {
    const { stdout } = await execFileAsync(electronPath, [`--user-data-dir=${scenarioRoot}`, runnerPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        KATIP_TEST_MODE: 'integration',
        KATIP_STAGE4_SCENARIO_ROOT: scenarioRoot
      },
      timeout: 105_000,
      maxBuffer: 4 * 1024 * 1024
    })
    const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX))
    if (!resultLine) throw new Error(`Electron Aşama 4 sonucu bulunamadı. Çıktı: ${stdout}`)
    report = JSON.parse(resultLine.slice(RESULT_PREFIX.length))
  } finally {
    rmSync(nodeModulesLink, { recursive: true, force: true })
    rmSync(electronRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
  }
})

describe('Aşama 4 yedek, restore ve telefon API entegrasyonu', () => {
  it('yalnız doğrulanmış geçici userData, temp ve SQLite yolunu kullanır', () => {
    const testRoot = dogrulanmisAnaTestDizini()
    expect(report.safety.scenarioRoot.startsWith(testRoot + sep)).toBe(true)
    expect(report.safety.tempPath.startsWith(report.safety.scenarioRoot + sep)).toBe(true)
    expect(report.safety.dbPath).toBe(report.safety.expectedDbPath)
    expect(report.backup.archiveInsideScenario).toBe(true)
  })

  it('veritabanı ve iki fotoğrafı tam yedek paketine alır', () => {
    expect(report.backup.result.success).toBe(true)
    expect(report.backup.result.photoCount).toBe(2)
    expect(report.backup.result.photoBytes).toBe(report.backup.expectedPhotoBytes)
    expect(report.backup.archiveSize).toBeGreaterThan(0)
  })

  it('arşiv sözleşmesini ve manifest bütünlüğünü doğrular', () => {
    expect(report.backup.entries).toEqual(expect.arrayContaining([
      'database/otoservis.db',
      'manifest.json',
      'fotograflar/nested/stage4-small.jpg',
      'fotograflar/stage4-streaming.bin'
    ]))
    expect(report.backup.manifest).toMatchObject({
      backupVersion: 1,
      product: 'Kâtip',
      databaseFile: 'database/otoservis.db',
      photosFolder: 'fotograflar',
      photoCount: 2,
      photoBytes: report.backup.expectedPhotoBytes
    })
  })

  it('mimariye özgü mevcut arşiv motorunu kullanır', () => {
    if (esmRuntime) {
      expect(report.backup.engine).toBe('tar.exe')
      expect(packageJson.devDependencies.electron).toMatch(/42\.7\.0/)
      expect(packageJson.dependencies['better-sqlite3']).toMatch(/12\.11\.1/)
    } else {
      expect(report.backup.engine).toBe('yazl/yauzl-streaming')
      expect(packageJson.devDependencies.electron).toBe('22.3.27')
      expect(packageJson.dependencies['better-sqlite3']).toBe('9.6.0')
      expect(packageJson.type).toBeUndefined()
      expect(packageJson.dependencies.yazl).toBeTruthy()
      expect(packageJson.dependencies.yauzl).toBeTruthy()
    }
  })

  it('güncelleme öncesi tam yedeği müşteri kaydını değiştirmeden oluşturur', () => {
    expect(report.updateBackup.result.success).toBe(true)
    expect(report.updateBackup.archiveInsideScenario).toBe(true)
    expect(report.updateBackup.filename).toMatch(/^guncelleme-oncesi-tam-yedek-.*\.zip$/)
    expect(report.updateBackup.customerAfterBackup).toMatchObject({
      name: 'Stage4 Original Customer',
      phone: '5554000001',
      note: 'backup fixture',
      is_active: 1
    })
    expect(report.updateBackup.quickCheck).toBe('ok')
  })

  it('bozuk DB yedeğini aktif veri ve fotoğrafı değiştirmeden reddeder', () => {
    expect(report.corruptRestore.result.success).toBe(false)
    expect(report.corruptRestore.marker.value).toBe('mutated')
    expect(report.corruptRestore.customer.name).toBe('Stage4 Mutated Customer')
    expect(report.corruptRestore.currentPhotoExists).toBe(true)
    expect(report.corruptRestore.quickCheck).toBe('ok')
  })

  it('zip slip girişini hedef dışına yazmadan reddeder', () => {
    expect(report.zipSlip.result.success).toBe(false)
    expect(report.zipSlip.sentinelExists).toBe(false)
    expect(report.zipSlip.marker.value).toBe('mutated')
    expect(report.zipSlip.currentPhotoExists).toBe(true)
    expect(report.zipSlip.quickCheck).toBe('ok')
  })

  it('DB ve fotoğrafları eksiksiz geri yükler', () => {
    expect(report.restore.result.success).toBe(true)
    expect(report.restore.result.restartRequired).toBe(true)
    expect(report.restore.marker.value).toBe('original')
    expect(report.restore.customer.name).toBe('Stage4 Original Customer')
    expect(report.restore.hashes).toEqual(report.backup.hashes)
    expect(report.restore.currentPhotoExists).toBe(false)
    expect(report.restore.quickCheck).toBe('ok')
    expect(report.restore.relaunchCalls).toBeGreaterThanOrEqual(1)
  })

  it('telefon sunucusunu rastgele geçici portta başlatır', () => {
    expect(report.phoneAuth.startResult).toMatchObject({ success: true, port: report.phoneAuth.port })
    expect(report.phoneAuth.port).toBeGreaterThan(0)
  })

  it('QR eşleşme koduyla oturum üretir ve ping çalışır', () => {
    expect(report.phoneAuth.pairInfo.success).toBe(true)
    expect(report.phoneAuth.pairResponse.status).toBe(200)
    expect(report.phoneAuth.pairResponse.json.success).toBe(true)
    expect(report.phoneAuth.pairResponse.json.token).toHaveLength(48)
    expect(report.phoneAuth.pingResponse).toMatchObject({ status: 200, json: { success: true } })
  })

  it('süresi dolmuş QR kodunu reddeder', () => {
    expect(report.phoneAuth.expiredPairResponse.status).toBe(400)
    expect(report.phoneAuth.expiredPairResponse.json.success).toBe(false)
  })

  it('Bearer token olmadan korumalı API ve mutasyonu reddeder', () => {
    expect(report.phoneAuth.unauthorizedResponse.status).toBe(401)
    expect(report.phoneAuth.unauthorizedResponse.json.requireLogin).toBe(true)
    expect(report.phoneMutation.unauthMutation.status).toBe(401)
  })

  it('yetkili mutasyonda istemcinin usta kimliğini değil oturum ustasını kullanır', () => {
    expect(report.phoneMutation.mutationResponse.json.success).toBe(true)
    expect(report.phoneMutation.apiWorkOrder.opened_by_master_id).toBe(report.phoneAuth.visibleMasterId)
    expect(report.phoneMutation.apiWorkOrder.opened_by_master_id).not.toBe(report.phoneAuth.hiddenMasterId)
  })

  it('geçersiz JSON isteğinde yarım iş emri bırakmaz', () => {
    expect(report.phoneMutation.malformedResponse.json.success).toBe(false)
    expect(report.phoneMutation.malformedAfter).toBe(report.phoneMutation.malformedBefore)
  })

  it('25 MB üstü istek gövdesini mutasyon yapmadan reddeder', () => {
    expect([0, 413]).toContain(report.phoneMutation.oversizedResponse.status)
    if (report.phoneMutation.oversizedResponse.status === 0) {
      expect(report.phoneMutation.oversizedResponse.error).toMatch(/ECONNRESET|socket/i)
    }
    expect(report.phoneMutation.oversizedAfter).toBe(report.phoneMutation.oversizedBefore)
  })

  it('aktif tahsilatın altına düşürecek mobil kalem silmeyi tamamen geri alır', () => {
    expect(report.phonePaymentFloor.addResponse.json.success).toBe(true)
    expect(report.phonePaymentFloor.before.order.total_price).toBe(100)
    expect(report.phonePaymentFloor.before.stock.stock).toBe(8)
    expect(report.phonePaymentFloor.before.payment).toMatchObject({ count: 1, total: 100 })
    expect(report.phonePaymentFloor.before.movements).toHaveLength(1)
    expect(report.phonePaymentFloor.deleteResponse.status).toBe(200)
    expect(report.phonePaymentFloor.deleteResponse.json.success).toBe(false)
    expect(report.phonePaymentFloor.deleteResponse.json.error).toMatch(/ödemelerin altına düşürülemez/i)
    expect(report.phonePaymentFloor.after).toEqual(report.phonePaymentFloor.before)
  })

  it('fotoğraf kökü içindeki dosyayı yetkili oturuma sunar', () => {
    expect(report.phonePhoto.insideStatus).toBe(200)
    expect(report.phonePhoto.insideHash).toBe(report.phonePhoto.expectedInsideHash)
  })

  it('fotoğraf kökü dışındaki DB yolunu servis etmez', () => {
    expect(report.phonePhoto.outsideStatus).toBe(403)
    expect(report.phonePhoto.outsideFileStillExists).toBe(true)
  })

  it('gizli destek hesabını listelemez ve telefon girişine açmaz', () => {
    expect(report.phoneSupport.visibleListed).toBe(true)
    expect(report.phoneSupport.hiddenListed).toBe(false)
    expect(report.phoneSupport.hiddenLogin.json.success).toBe(false)
  })

  it('restore sürerken telefon mutasyonlarını 503 ile engeller', () => {
    expect(report.phoneRestoreGuard.response.status).toBe(503)
    expect(report.phoneRestoreGuard.guardedAfter).toBe(report.phoneRestoreGuard.guardedBefore)
  })

  it('24 saat hareketsiz oturumu sona erdirir', () => {
    expect(report.phoneSessionTtl.pairResponse.json.success).toBe(true)
    expect(report.phoneSessionTtl.expiredSessionResponse.status).toBe(401)
    expect(report.phoneSessionTtl.expiredSessionResponse.json.requireLogin).toBe(true)
  })

  it('15 hatalı PIN sonrası aynı IP için rate limit uygular', () => {
    expect(report.phoneRateLimit.attempts).toHaveLength(15)
    expect(report.phoneRateLimit.attempts.every((result: any) => result.success === false)).toBe(true)
    expect(report.phoneRateLimit.lockedResponse.json.success).toBe(false)
    expect(report.phoneRateLimit.lockedResponse.json.error).toMatch(/Çok fazla|kilit/i)
  })

  it('oturum iptalini uygular ve sunucuyu temiz kapatır', () => {
    expect(report.phoneLifecycle.revokedResponse.status).toBe(401)
    expect(report.phoneLifecycle.stopResult).toBe(true)
    expect(report.phoneLifecycle.runningAfterStop).toBe(false)
  })

  it('telefon testlerinde yalnız loopback kullanır ve SQLite sağlıklı kalır', () => {
    expect(report.phoneLifecycle.onlyLoopback).toBe(true)
    expect(new Set(report.phoneLifecycle.requestedHosts)).toEqual(new Set(['127.0.0.1']))
    expect(report.quickCheck).toBe('ok')
  })
})
