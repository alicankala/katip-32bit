const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const commonFiles = [
  'electron/controllers/accountController.ts',
  'electron/controllers/closingController.ts',
  'electron/controllers/customerController.ts',
  'electron/controllers/masterController.ts',
  'electron/controllers/partController.ts',
  'electron/controllers/phoneController.ts',
  'electron/controllers/settingsController.ts',
  'electron/controllers/vehicleController.ts',
  'electron/controllers/workOrderController.ts',
  'electron/database.d.ts',
  'electron/permissions.ts',
  'electron/restoreState.ts',
  'electron/security.ts',
  'electron/session.ts',
  'electron/phoneAssets.ts',
  'electron/phoneAuthState.ts',
  'electron/phoneHttpUtils.ts',
  'electron/phoneMigrations.ts',
  'tests/business/business-rules.test.ts',
  'tests/stage4/stage4.test.ts'
]

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function repositoryName(root) {
  return path.basename(path.resolve(root)).toLowerCase()
}

function normalizedHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

const currentRoot = path.resolve(option('--current') || process.cwd())
const currentName = repositoryName(currentRoot)
const expectedPeerName = currentName === 'katip-64bit' ? 'katip-32bit' : 'katip-64bit'
const peerRoot = path.resolve(option('--peer') || path.join(currentRoot, '..', expectedPeerName))

if (!['katip-64bit', 'katip-32bit'].includes(currentName)) {
  throw new Error(`Geçerli repo kökü bekleniyordu, bulunan: ${currentRoot}`)
}

const problems = []
for (const relativePath of commonFiles) {
  const currentFile = path.join(currentRoot, relativePath)
  const peerFile = path.join(peerRoot, relativePath)
  if (!fs.existsSync(currentFile) || !fs.existsSync(peerFile)) {
    problems.push(`${relativePath}: dosya iki repodan birinde eksik`)
    continue
  }
  if (normalizedHash(currentFile) !== normalizedHash(peerFile)) {
    problems.push(`${relativePath}: ortak içerik farklı`)
  }
}

if (problems.length > 0) {
  console.error('Kâtip mimari eşleme kontrolü başarısız:')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log(`Kâtip mimari eşleme kontrolü başarılı: ${commonFiles.length} ortak kritik dosya eşleşiyor.`)
  console.log('Bilinçli mimari farklar docs/ARCHITECTURE_SYNC.md içinde ayrı tutuluyor.')
}
