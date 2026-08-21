<#
  Kâtip - Sürüm yayınlama betiği
  ==============================

  Ne yapar:
    1. Çalışma dizininde kaydedilmemiş değişiklik var mı bakar
    2. package.json'daki sürümün GitHub'da zaten yayınlanmadığını doğrular
    3. npm run build ile kurulum dosyasını üretir
    4. latest.yml içindeki dosya adının gerçek dosyayla eşleştiğini doğrular
       (uyuşmazsa otomatik güncelleme sessizce çalışmaz - 1.0.0/1.0.1'de bu oldu)
    5. TASLAK release oluşturur; taslağı güncelleyiciler görmez
    6. Üç dosyayı da yükler
    7. Kurulum dosyasının boyutunu bayt bayt doğrular
    8. Ancak her şey doğruysa taslağı yayına alır

  Kullanımı (PowerShell, proje klasöründe):
      .\scripts\yayinla.ps1

  Önce yapılması gerekenler:
      package.json içindeki "version" yükseltilir  (ör. 1.0.2 -> 1.0.3)
      git add -A ; git commit -m "..." ; git push

  GitHub anahtarı: git'in Windows Credential Manager'da sakladığı kimlik
  kullanılır. Ayrıca token oluşturmanız gerekmez.
#>

param(
  [switch]$AtlaBuild   # Derleme zaten yapıldıysa: .\scripts\yayinla.ps1 -AtlaBuild
)

$ErrorActionPreference = 'Stop'
$repo = 'alicankala/katip-32bit'

function Vazgec($mesaj) {
  Write-Host ""
  Write-Host "DURDURULDU: $mesaj" -ForegroundColor Red
  exit 1
}

function Basarili($mesaj) { Write-Host "  [tamam] $mesaj" -ForegroundColor Green }
function Bilgi($mesaj)    { Write-Host "  $mesaj" -ForegroundColor Gray }

# Proje kökü (bu betik scripts/ altında)
$kok = Split-Path -Parent $PSScriptRoot
Set-Location $kok

Write-Host ""
Write-Host "=== Katip surum yayinlama ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Sürüm ve çalışma dizini ────────────────────────────────
$surum = (Get-Content package.json -Raw | ConvertFrom-Json).version
if (-not $surum) { Vazgec "package.json icinde version bulunamadi." }
$etiket = "v$surum"
Write-Host "Surum: $surum" -ForegroundColor White

$kirli = git status --porcelain
if ($kirli) {
  Write-Host ""
  Write-Host "UYARI: kaydedilmemis degisiklikler var:" -ForegroundColor Yellow
  git status --short
  Write-Host ""
  $cevap = Read-Host "Yine de devam edilsin mi? (e/h)"
  if ($cevap -ne 'e') { Vazgec "Once commit edip push edin." }
}

# ── 2. GitHub anahtarı ────────────────────────────────────────
# git credential fill'e girdi LF ile verilmeli: PowerShell borusu satir sonlarina
# CR ekliyor ve git "credential missing protocol field" diyerek reddediyor.
# Gecici dosyada sir yok, yalnizca sorgu satirlari var.
$sorguDosyasi = Join-Path $env:TEMP "katip_cred_$PID.txt"
[System.IO.File]::WriteAllText($sorguDosyasi, "protocol=https`nhost=github.com`n`n")
try {
  $kimlik = cmd /c "git credential fill < `"$sorguDosyasi`"" 2>$null
} finally {
  Remove-Item $sorguDosyasi -ErrorAction SilentlyContinue
}
$token = ($kimlik | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { Vazgec "GitHub anahtari alinamadi. Once bir kez 'git push' yapip kimlik kaydedin." }
$baslik = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' }
Basarili "GitHub kimligi alindi"

# ── 3. Bu sürüm zaten yayında mı? ─────────────────────────────
try {
  $mevcut = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$etiket" -Headers $baslik
  if ($mevcut -and -not $mevcut.draft) {
    Vazgec "$etiket zaten yayinlanmis. Once package.json icindeki surumu yukseltin."
  }
  if ($mevcut -and $mevcut.draft) {
    Bilgi "$etiket icin bekleyen bir taslak var, siliniyor..."
    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($mevcut.id)" -Headers $baslik -Method Delete | Out-Null
  }
} catch {
  # 404 = bu surum henuz yok, beklenen durum
}

# ── 4. Derleme ────────────────────────────────────────────────
if (-not $AtlaBuild) {
  Write-Host ""
  Write-Host "Derleniyor (birkac dakika surer)..." -ForegroundColor White
  npm run build
  if ($LASTEXITCODE -ne 0) { Vazgec "Derleme basarisiz." }
  Basarili "Derleme tamam"
}

# ── 5. Dosyalar ve latest.yml tutarlılığı ─────────────────────
$klasor = Join-Path $kok "release\$surum"
if (-not (Test-Path $klasor)) { Vazgec "Cikti klasoru yok: $klasor" }

$manifest = Join-Path $klasor 'latest.yml'
if (-not (Test-Path $manifest)) { Vazgec "latest.yml bulunamadi." }

$beklenenAd = ((Get-Content $manifest | Where-Object { $_ -match '^\s*-?\s*url:' }) -split 'url:')[1].Trim()
$kurulum = Join-Path $klasor $beklenenAd
if (-not (Test-Path $kurulum)) {
  Write-Host ""
  Write-Host "latest.yml su dosyayi bekliyor : $beklenenAd" -ForegroundColor Yellow
  Write-Host "Klasordeki dosyalar:" -ForegroundColor Yellow
  Get-ChildItem $klasor -Filter *.exe | ForEach-Object { Write-Host "  $($_.Name)" }
  Vazgec "latest.yml ile kurulum dosyasinin adi tutmuyor. Boyle yayinlanirsa otomatik guncelleme sessizce calismaz."
}
Basarili "latest.yml ile dosya adi tutuyor: $beklenenAd"

$blockmap = "$kurulum.blockmap"
if (-not (Test-Path $blockmap)) { Vazgec "blockmap dosyasi bulunamadi." }

$kurulumBoyut = (Get-Item $kurulum).Length
Bilgi ("Kurulum dosyasi: {0:N1} MB" -f ($kurulumBoyut / 1MB))

# ── 6. Taslak release ─────────────────────────────────────────
Write-Host ""
Write-Host "Taslak release olusturuluyor..." -ForegroundColor White
$govde = @{
  tag_name   = $etiket
  name       = $surum
  body       = "Katip $surum"
  draft      = $true      # yuklemeler bitene kadar guncelleyiciler gormesin
  prerelease = $false
} | ConvertTo-Json

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Headers $baslik -Method Post -Body $govde -ContentType 'application/json'
$id = $release.id
Basarili "Taslak olusturuldu (ID $id)"

# ── 7. Yükleme ────────────────────────────────────────────────
# curl.exe kullaniliyor: 100+ MB dosyalarda Invoke-RestMethod'dan cok daha guvenilir
$curl = "$env:SystemRoot\System32\curl.exe"
if (-not (Test-Path $curl)) { Vazgec "curl.exe bulunamadi." }

foreach ($dosya in @($kurulum, $blockmap, $manifest)) {
  $ad = Split-Path $dosya -Leaf
  Write-Host "  Yukleniyor: $ad" -ForegroundColor White
  $sonuc = & $curl -s -o NUL -w '%{http_code}' `
    -X POST `
    -H "Authorization: Bearer $token" `
    -H "Content-Type: application/octet-stream" `
    -H "Expect:" `
    --data-binary "@$dosya" `
    "https://uploads.github.com/repos/$repo/releases/$id/assets?name=$ad"
  if ($sonuc -ne '201') { Vazgec "$ad yuklenemedi (HTTP $sonuc). Taslak silinmedi, tekrar deneyebilirsiniz." }
  Basarili "$ad yuklendi"
}

# ── 8. Doğrulama ──────────────────────────────────────────────
Write-Host ""
Write-Host "Dogrulaniyor..." -ForegroundColor White
$kontrol = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$id" -Headers $baslik
$yuklenen = $kontrol.assets | Where-Object { $_.name -eq $beklenenAd }

if (-not $yuklenen)                        { Vazgec "Kurulum dosyasi release'de gorunmuyor." }
if ($yuklenen.state -ne 'uploaded')        { Vazgec "Kurulum dosyasi eksik yuklendi (durum: $($yuklenen.state))." }
if ($yuklenen.size -ne $kurulumBoyut)      { Vazgec "Boyut tutmuyor: $($yuklenen.size) yerine $kurulumBoyut olmaliydi." }
Basarili "Kurulum dosyasi tam ve dogru boyutta"

# ── 9. Yayına al ──────────────────────────────────────────────
$yayin = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$id" -Headers $baslik -Method Patch -Body '{"draft":false}' -ContentType 'application/json'

Write-Host ""
Write-Host "=== YAYINLANDI ===" -ForegroundColor Green
Write-Host "Surum : $surum"
Write-Host "Adres : $($yayin.html_url)"
Write-Host ""
Write-Host "Musteriler programi actiginda guncelleme kendiliginden inecek." -ForegroundColor Cyan
Write-Host ""
