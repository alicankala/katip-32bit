const DIS_ADRES_DESENI = /^https?:\/\//i

export function disAdresMi(url: string): boolean {
  return DIS_ADRES_DESENI.test(url)
}

/**
 * Servis fişi, cari ekstre ve gün sonu raporu HTML'lerini önce boş bir yerel
 * pencereye yazar. Electron, window.open('', '_blank') adresini about:blank
 * olarak çözer. Yalnızca bu adres yeni pencere olarak açılabilir; dosya,
 * javascript, data ve uzak adresler uygulama içinde yeni pencere oluşturamaz.
 */
export function yerelYazdirmaPenceresiMi(url: string): boolean {
  // Electron 22, file:// renderer içindeki window.open('', '_blank') isteğini
  // Windows'ta about:blank#blocked olarak raporlayabiliyor. İkisi de ağ veya
  // dosya kaynağı yüklemeyen aynı boş belgeyi ifade eder.
  return url === 'about:blank' || url === 'about:blank#blocked'
}

export function yeniPencereKarari(url: string) {
  if (!yerelYazdirmaPenceresiMi(url)) return { action: 'deny' as const }

  return {
    action: 'allow' as const,
    overrideBrowserWindowOptions: {
      width: 1100,
      height: 800,
      minWidth: 720,
      minHeight: 520,
      frame: true,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    }
  }
}
