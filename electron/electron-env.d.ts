/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Renderer tarafında preload.ts ile açılan API
interface Window {
  api: {
    // Pencere
    pencereKucult: () => Promise<any>
    pencereBuyutKucult: () => Promise<any>
    pencereKapat: () => Promise<any>
    pencereDurumGetir: () => Promise<{ success: boolean; isMaximized: boolean }>
    onPencereDurumDegisti: (callback: (isMaximized: boolean) => void) => () => void

    // Müşteriler
    musterileriGetir: () => Promise<any>
    musteriEkle: (musteri: any) => Promise<any>
    musteriSil: (id: number) => Promise<any>
    musteriGuncelle: (musteri: any) => Promise<any>

    // Yedek Parça / Stok
    parcalariGetir: () => Promise<any>
    parcaEkle: (parca: any) => Promise<any>
    parcaGuncelle: (parca: any) => Promise<any>
    parcaSil: (id: number) => Promise<any>
    parcaAktiflestir: (id: number) => Promise<any>
    stokHareketleriGetir: (partId: number) => Promise<any>
    dusukStokParcalariGetir: (limit?: number) => Promise<any[]>

    // Araçlar
    araclariGetir: () => Promise<any>
    aracEkle: (arac: any) => Promise<any>
    aracGuncelle: (arac: any) => Promise<any>
    aracSil: (id: number) => Promise<any>

    // İş Emirleri
    isEmirleriGetir: () => Promise<any>
    isEmriEkle: (isEmri: any) => Promise<any>
    isEmriSil: (id: number) => Promise<any>
    isEmriGuncelle: (isEmri: any) => Promise<any>
    isEmriKalemleriGetir: (workOrderId: number) => Promise<any>
    isEmriKalemEkle: (kalem: any) => Promise<any>
    isEmriKalemSil: (itemId: number) => Promise<any>
    isEmriOdemeleriGetir: (workOrderId: number) => Promise<any>
    isEmriOdemeEkle: (odeme: any) => Promise<any>
    isEmriOdemeIptal: (veri: any) => Promise<any>
    isEmriOdemeOzetiGetir: (workOrderId: number) => Promise<any>
    musteriIsEmriAlacaklariGetir: (customerId?: number) => Promise<any>
    isEmriTamamlaVeOdemeKaydet: (veri: any) => Promise<any>

    // Ana Panel / Geçmiş
    istatistikleriGetir: () => Promise<any>
    anaPanelBorclariGetir: (limit?: number) => Promise<any>
    musteriGecmisiGetir: (id: number) => Promise<any>

// Veritabanı
veritabaniYedekle: () => Promise<any>
yedekKlasorunuAc: () => Promise<any>
yedektenGeriYukle: () => Promise<any>
veritabaniBilgileriGetir: () => Promise<any>
veritabaniSifirla: () => Promise<{ success: boolean; backupPath?: string; restartRequired?: boolean; error?: string }>

    // Cari Hesaplar
    cariHesapleriGetir: () => Promise<any>
    cariHesaplariGetir: () => Promise<any>
    cariHesapEkle: (hesap: any) => Promise<any>
    cariHesapGuncelle: (hesap: any) => Promise<any>
    cariHesapSil: (id: number) => Promise<any>
    cariIslemleriGetir: (currentAccountId: number) => Promise<any>
    cariIslemEkle: (islem: any) => Promise<any>
    cariIslemSil: (id: number) => Promise<any>
    cariOdemeleriGetir: (currentAccountId: number) => Promise<any>
    cariOdemeEkle: (odeme: any) => Promise<any>
    cariOdemeSil: (id: number) => Promise<any>
    uygulamaVerileriniYenile: () => Promise<{ success: boolean; message: string; refreshedAt?: string }>
    ayarlariGetir: () => Promise<{ success: boolean; settings: Record<string, string> }>
    ayarlariKaydet: (settings: Record<string, string>) => Promise<{ success: boolean; error?: string }>
    destekSistemBilgileriGetir: () => Promise<any>
    veritabaniKontrolEt: () => Promise<{ success: boolean; message: string; checkedAt?: string }>
    otomatikYedekAl: () => Promise<{ success: boolean; path?: string; filename?: string; error?: string }>
    logKlasoruAc: () => Promise<{ success: boolean; error?: string }>
    adminPinDogrula: (pin: string) => Promise<{ success: boolean; error?: string }>
    adminPinDegistir: (veri: { eski_pin: string; yeni_pin: string }) => Promise<{ success: boolean; error?: string }>
    isEmriFotograflariGetir: (workOrderId: number) => Promise<{ success: boolean; fotograflar?: any[]; error?: string }>
    fotografKategorileriGetir: () => Promise<{ success: boolean; kategoriler?: string[]; error?: string }>
    isEmriFotografYukleDialog: (veri: { work_order_id: number; category?: string; note?: string }) => Promise<{ success: boolean; count?: number; canceled?: boolean; error?: string }>
    isEmriFotografSil: (photoId: number) => Promise<{ success: boolean; error?: string }>
    isEmriFotografGuncelle: (veri: { id: number; category?: string; note?: string }) => Promise<{ success: boolean; error?: string }>
    telefonEslesmeQrOlustur: (masterId?: number) => Promise<{ success: boolean; token?: string; pairingUrl?: string; qrDataUrl?: string; expiresAt?: number; masterName?: string; error?: string }>
    telefonOturumlariGetir: () => Promise<{ success: boolean; sessions?: any[]; error?: string }>
    telefonOturumKapat: (token: string) => Promise<{ success: boolean; error?: string }>
    telefonTumOturumlariKapat: () => Promise<{ success: boolean; error?: string }>

    // Gün Sonu (Günlük Kapanış)
    gunSonuOzetiGetir: (tarih?: string) => Promise<{ success: boolean; ozet?: any; kapanis?: any; error?: string }>
    gunSonuKapat: (veri: { closing_date: string; counted_cash?: number | null; note?: string }) => Promise<{ success: boolean; id?: number; kapanis?: any; error?: string }>
    gunSonuKapanislariGetir: (limit?: number) => Promise<{ success: boolean; kapanislar?: any[]; error?: string }>
    gunSonuKapanisAc: (veri: { closing_date: string; admin_pin: string; reason: string }) => Promise<{ success: boolean; error?: string }>
    gunSonuYenidenAcmaLoglariGetir: (limit?: number) => Promise<{ success: boolean; loglar?: any[]; error?: string }>
    pencereKapatZorla: () => Promise<{ success: boolean }>
    dovizKurlariGetir: () => Promise<{ success: boolean; kurlar?: Record<string, { alis: number | null; satis: number | null }>; kaynakTarihi?: string | null; guncellendi?: string; cached?: boolean; stale?: boolean; error?: string }>
    havaDurumuGetir: () => Promise<{ success: boolean; sehir?: string; sicaklik?: number; durum?: string; kod?: number; guncellendi?: string; cached?: boolean; stale?: boolean; error?: string }>
    onGunSonuHatirlatma: (callback: () => void) => () => void
  }
}
