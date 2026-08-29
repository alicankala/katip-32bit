const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const builder = read('electron-builder.json5')
const main = read('electron/main.ts')
const backup = read('electron/controllers/backupController.ts')
const workflow = read('.github/workflows/database-integration.yml')

const checks = [
  ['package.json CommonJS kalmalı', pkg.type === undefined],
  ['Electron tam 22.3.27 olmalı', pkg.devDependencies.electron === '22.3.27'],
  ['better-sqlite3 tam 9.6.0 olmalı', pkg.dependencies['better-sqlite3'] === '9.6.0'],
  ['lockfile Electron 22.3.27 çözmeli', lock.packages['node_modules/electron']?.version === '22.3.27'],
  ['lockfile better-sqlite3 9.6.0 çözmeli', lock.packages['node_modules/better-sqlite3']?.version === '9.6.0'],
  ['preload CommonJS .js çıkışı kullanılmalı', main.includes("path.join(__dirname, 'preload.js')")],
  ['Win7 NodeHttpExecutor korunmalı', main.includes("import { NodeHttpExecutor } from './nodeHttpExecutor.js'") && main.includes('new NodeHttpExecutor()')],
  ['x86 metin çizimi için donanım hızlandırma kapalı olmalı', main.includes('app.disableHardwareAcceleration()')],
  ['NSIS hedefi ia32 olmalı', /"arch"\s*:\s*\[\s*"ia32"\s*\]/m.test(builder)],
  ['x86 artefakt adı korunmalı', builder.includes('Katip-Windows-x86-${version}-Setup.${ext}')],
  ['updater katip-32bit reposunu hedeflemeli', /"repo"\s*:\s*"katip-32bit"/.test(builder)],
  ['streaming ZIP bağımlılıkları korunmalı', pkg.dependencies.yazl && pkg.dependencies.yauzl && backup.includes("from 'yazl'") && backup.includes("from 'yauzl'")],
  ['CI yayın yapmamalı', workflow.includes('npm run build -- --publish never')]
]

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name)
if (failures.length > 0) {
  console.error('Win7/x86 otomatik sözleşme kontrolü başarısız:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Win7/x86 otomatik sözleşme kontrolü başarılı: ${checks.length} sınır korundu.`)
  console.log('Bu sonuç gerçek Windows 7 cihaz testi değildir; manuel prosedür hâlâ zorunludur.')
}
