const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const pkg = JSON.parse(read('package.json'))
const builder = read('electron-builder.json5')
const workflow = read('.github/workflows/database-integration.yml')
const releaseScript = read('scripts/yayinla.ps1')
const main = read('electron/main.ts')
const database = read('electron/database.js')
const settings = read('electron/controllers/settingsController.ts')
const x86 = pkg.type !== 'module'
const expectedRepo = x86 ? 'katip-32bit' : 'katip-64bit'
const expectedArch = x86 ? 'ia32' : 'x64'
const expectedArtifact = x86
  ? 'Katip-Windows-x86-${version}-Setup.${ext}'
  : 'Katip-Windows-${version}-Setup.${ext}'

const checks = [
  ['GitHub updater reposu doğru', new RegExp(`"repo"\\s*:\\s*"${expectedRepo}"`).test(builder)],
  ['NSIS mimarisi doğru', new RegExp(`"arch"\\s*:\\s*\\[\\s*"${expectedArch}"\\s*\\]`, 'm').test(builder)],
  ['Installer artefakt adı doğru', builder.includes(expectedArtifact)],
  ['Uninstall userData silmiyor', /"deleteAppDataOnUninstall"\s*:\s*false/.test(builder)],
  ['CI build yayın yapmıyor', workflow.includes('npm run build -- --publish never')],
  ['Release build yayın yapmıyor', releaseScript.includes('npm run build -- --publish never')],
  ['Release script doğru repoyu hedefliyor', releaseScript.includes(`$repo = 'alicankala/${expectedRepo}'`)],
  ['Release latest.yml ve blockmap doğruluyor', releaseScript.includes("'latest.yml'") && releaseScript.includes('$blockmap')],
  ['Updater hata ve indirme olaylarını logluyor', main.includes("autoUpdater.on('error'") && main.includes("autoUpdater.on('update-downloaded'")],
  ['Yerel crash tanı hookları var', main.includes("process.on('uncaughtExceptionMonitor'") && main.includes("app.on('render-process-gone'")],
  ['Log klasörü kullanıcı tarafından açılabiliyor', settings.includes("kanalEkle('log-klasoru-ac'")],
  ['PIN değeri loglanmıyor', !database.includes('${usta.pin}')]
]

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name)
if (failures.length) {
  console.error('Release/destek sözleşme kontrolü başarısız:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Release/destek sözleşme kontrolü başarılı: ${checks.length} sınır korundu.`)
  console.log('Code signing ve gerçek eski sürüm güncellemesi ayrıca manuel doğrulanmalıdır.')
}
