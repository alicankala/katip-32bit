<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useFormatters } from '../composables/useFormatters'
import { firmaBilgileri } from '../data/firmaBilgileri.js'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

const toast = useToast()
const confirmDialog = useConfirm()

// Günü KAPATMA usta işidir (kapanışa kapatan usta yazılır); günü YENİDEN AÇMA
// zaten Admin PIN isteyen bir destek işlemidir, o yüzden destek modunda açık kalır.
const { destekModu, destekModundaEngelle } = useYetki()
const { tlFormatla, tarihFormatla, tarihSaatFormatla } = useFormatters()

function bugununTarihi() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const seciliTarih = ref(bugununTarihi())
const yukleniyor = ref(false)
const kapatiliyor = ref(false)

const ozet = ref(null)
const kapanis = ref(null)
const gecmisKapanislar = ref([])
const yenidenAcmaLoglari = ref([])

// Kapanış formu
const sayilanNakit = ref(null)
const kapanisNotu = ref('')

const bugun = computed(() => bugununTarihi())
const gelecekTarih = computed(() => seciliTarih.value > bugun.value)

const nakitFarki = computed(() => {
  if (sayilanNakit.value === null || sayilanNakit.value === '' || !ozet.value) return null
  const s = Number(sayilanNakit.value)
  if (!Number.isFinite(s)) return null
  return s - Number(ozet.value.beklenenNakit || 0)
})

const farkVar = computed(() => nakitFarki.value !== null && Math.abs(nakitFarki.value) > 0.009)

const farkRenk = (fark) => {
  if (fark === null || fark === undefined) return 'var(--text-muted)'
  const f = Number(fark)
  if (f > 0.009) return '#f59e0b'
  if (f < -0.009) return '#ef4444'
  return '#10b981'
}

const veriYukle = async () => {
  yukleniyor.value = true
  try {
    const [ozetRes, gecmisRes, yenidenAcmaRes] = await Promise.all([
      window.api.gunSonuOzetiGetir(seciliTarih.value),
      window.api.gunSonuKapanislariGetir(60),
      window.api.gunSonuYenidenAcmaLoglariGetir(60)
    ])

    if (ozetRes?.success) {
      ozet.value = ozetRes.ozet
      kapanis.value = ozetRes.kapanis
    } else {
      ozet.value = null
      kapanis.value = null
      toast.add({ severity: 'error', summary: 'Hata', detail: ozetRes?.error || 'Gün sonu özeti alınamadı.', life: 4000 })
    }

    if (gecmisRes?.success) {
      gecmisKapanislar.value = gecmisRes.kapanislar || []
    }

    if (yenidenAcmaRes?.success) {
      yenidenAcmaLoglari.value = yenidenAcmaRes.loglar || []
    }
  } catch (e) {
    console.error('Gün sonu verisi yükleme hatası:', e)
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Gün sonu verisi yüklenemedi.', life: 4000 })
  } finally {
    yukleniyor.value = false
  }
}

const tarihDegisti = () => {
  sayilanNakit.value = null
  kapanisNotu.value = ''
  veriYukle()
}

const gunuKapat = () => {
  if (destekModundaEngelle(toast, 'Gün sonu kapatma destek modunda yapılamaz.')) return
  if (!ozet.value) return

  if (farkVar.value && !kapanisNotu.value.trim()) {
    toast.add({ severity: 'warn', summary: 'Not Gerekli', detail: 'Kasa farkı var. Lütfen farkın nedenini not alanına yazın.', life: 4000 })
    return
  }

  const farkMetni = nakitFarki.value === null
    ? 'Kasa sayımı girilmedi.'
    : `Kasa farkı: ${tlFormatla(nakitFarki.value)}`

  confirmDialog.require({
    message: `${tarihFormatla(seciliTarih.value)} günü kapatılacak. ${farkMetni} Kapanış kaydı sonradan değiştirilemez. Onaylıyor musunuz?`,
    header: 'Günü Kapat',
    icon: 'pi pi-lock',
    acceptLabel: 'Evet, Kapat',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-danger',
    accept: async () => {
      kapatiliyor.value = true
      try {
        const res = await window.api.gunSonuKapat({
          closing_date: seciliTarih.value,
          counted_cash: sayilanNakit.value === '' ? null : sayilanNakit.value,
          note: kapanisNotu.value
        })
        if (res?.success) {
          toast.add({ severity: 'success', summary: 'Gün Kapatıldı', detail: 'Gün sonu kapanışı kaydedildi.', life: 3000 })
          sayilanNakit.value = null
          kapanisNotu.value = ''
          await veriYukle()
          window.dispatchEvent(new CustomEvent('app-data-refreshed'))
        } else {
          toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Kapanış kaydedilemedi.', life: 4000 })
        }
      } catch (e) {
        console.error('Gün kapatma hatası:', e)
        toast.add({ severity: 'error', summary: 'Hata', detail: 'Kapanış kaydedilemedi.', life: 4000 })
      } finally {
        kapatiliyor.value = false
      }
    }
  })
}

// ── Günü Yeniden Açma (Admin PIN gerekir) ─────────
const acilisDialogAcik = ref(false)
const adminPinGirisi = ref('')
const acilisNedeni = ref('')
const acilisYukleniyor = ref(false)

const acilisDialogunuAc = () => {
  adminPinGirisi.value = ''
  acilisNedeni.value = ''
  acilisDialogAcik.value = true
}

const adminPinDuzenle = (event) => {
  adminPinGirisi.value = String(event.target.value || '').replace(/\D/g, '').slice(0, 4)
}

const gunuYenidenAc = async () => {
  if (acilisYukleniyor.value) return
  if (!acilisNedeni.value.trim()) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Günü yeniden açma nedenini yazmalısınız.', life: 3000 })
    return
  }
  if (adminPinGirisi.value.length !== 4) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Admin PIN 4 haneli olmalıdır.', life: 3000 })
    return
  }

  acilisYukleniyor.value = true
  try {
    const res = await window.api.gunSonuKapanisAc({
      closing_date: seciliTarih.value,
      admin_pin: adminPinGirisi.value,
      reason: acilisNedeni.value.trim()
    })
    if (res?.success) {
      acilisDialogAcik.value = false
      toast.add({ severity: 'success', summary: 'Gün Açıldı', detail: 'Kapanış kaydı silindi. Gün yeniden kapatılabilir.', life: 3500 })
      await veriYukle()
      window.dispatchEvent(new CustomEvent('app-data-refreshed'))
    } else {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Gün yeniden açılamadı.', life: 4000 })
    }
  } catch (e) {
    console.error('Günü yeniden açma hatası:', e)
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Gün yeniden açılamadı.', life: 4000 })
  } finally {
    acilisYukleniyor.value = false
    adminPinGirisi.value = ''
    acilisNedeni.value = ''
  }
}

// ── Z-Raporu Yazdırma ─────────────────────────────
const guvenliMetin = (deger) => {
  return String(deger ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const raporYazdir = () => {
  if (!ozet.value) return
  const o = ozet.value
  const k = kapanis.value

  const tahsilatSatirlari = (o.tahsilatlar || []).map((t, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${guvenliMetin(t.kaynak)}</td>
      <td>${guvenliMetin(t.aciklama)}</td>
      <td>${guvenliMetin(t.yontem)}</td>
      <td class="right strong">${guvenliMetin(tlFormatla(t.tutar))}</td>
    </tr>
  `).join('')

  const cikisSatirlari = (o.cikislar || []).map((c, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${guvenliMetin(c.kaynak)}</td>
      <td>${guvenliMetin(c.aciklama)}</td>
      <td>${guvenliMetin(c.yontem)}</td>
      <td class="right strong">${guvenliMetin(tlFormatla(c.tutar))}</td>
    </tr>
  `).join('')

  const kapanisBlogu = k ? `
    <div class="box">
      <div class="box-title">Kapanış Bilgisi</div>
      <table class="kv">
        <tr><td>Kapatan</td><td class="right">${guvenliMetin(k.master_name || k.closed_by_name || '-')}</td></tr>
        <tr><td>Kapanış Zamanı</td><td class="right">${guvenliMetin(tarihSaatFormatla(k.created_at))}</td></tr>
        <tr><td>Beklenen Nakit</td><td class="right">${guvenliMetin(tlFormatla(k.expected_cash))}</td></tr>
        <tr><td>Sayılan Nakit</td><td class="right">${k.counted_cash === null || k.counted_cash === undefined ? '-' : guvenliMetin(tlFormatla(k.counted_cash))}</td></tr>
        <tr><td>Kasa Farkı</td><td class="right strong">${k.cash_difference === null || k.cash_difference === undefined ? '-' : guvenliMetin(tlFormatla(k.cash_difference))}</td></tr>
        ${k.note ? `<tr><td>Not</td><td class="right">${guvenliMetin(k.note)}</td></tr>` : ''}
      </table>
    </div>
  ` : ''

  const pencere = window.open('', '_blank')
  if (!pencere) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Yazdırma penceresi açılamadı.', life: 3000 })
    return
  }

  pencere.document.write(`
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charset="UTF-8" />
        <title>Gün Sonu Raporu - ${guvenliMetin(tarihFormatla(o.tarih))}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
          .firma { font-size: 15px; font-weight: 800; letter-spacing: -0.2px; margin-bottom: 2px; }
          h1 { font-size: 18px; margin: 0; }
          .sub { color: #555; margin: 2px 0 16px; }
          .box { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; }
          .box-title { font-weight: 700; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; }
          table.list th, table.list td { border-bottom: 1px solid #e5e5e5; padding: 5px 6px; text-align: left; }
          table.list th { background: #f5f5f5; font-size: 11px; }
          table.kv td { padding: 3px 0; }
          .right { text-align: right; }
          .center { text-align: center; }
          .strong { font-weight: 700; }
          .totals td { padding: 3px 0; font-size: 12.5px; }
          .grand { font-size: 14px; font-weight: 800; border-top: 1px solid #999; }
          @media print { body { padding: 8mm; } }
        </style>
      </head>
      <body>
        <div class="firma">${guvenliMetin(firmaBilgileri.unvan)}</div>
        <h1>Gün Sonu Raporu</h1>
        <div class="sub">${guvenliMetin(tarihFormatla(o.tarih))}</div>

        <div class="box">
          <div class="box-title">Özet</div>
          <table class="totals">
            <tr><td>Nakit Tahsilat</td><td class="right">${guvenliMetin(tlFormatla(o.yontemTahsilat.nakit))}</td></tr>
            <tr><td>Kart Tahsilat</td><td class="right">${guvenliMetin(tlFormatla(o.yontemTahsilat.kart))}</td></tr>
            <tr><td>Havale / EFT Tahsilat</td><td class="right">${guvenliMetin(tlFormatla(o.yontemTahsilat.havale))}</td></tr>
            <tr><td>Diğer Tahsilat</td><td class="right">${guvenliMetin(tlFormatla(o.yontemTahsilat.diger))}</td></tr>
            <tr class="grand"><td>Toplam Tahsilat</td><td class="right">${guvenliMetin(tlFormatla(o.toplamTahsilat))}</td></tr>
            <tr><td>Toplam Çıkış (Gider + Tedarikçi)</td><td class="right">-${guvenliMetin(tlFormatla(o.toplamCikis))}</td></tr>
            <tr class="grand"><td>Beklenen Nakit (Gün İçi)</td><td class="right">${guvenliMetin(tlFormatla(o.beklenenNakit))}</td></tr>
          </table>
        </div>

        ${kapanisBlogu}

        <div class="box">
          <div class="box-title">Tahsilatlar (${(o.tahsilatlar || []).length})</div>
          <table class="list">
            <tr><th>#</th><th>Kaynak</th><th>Açıklama</th><th>Yöntem</th><th class="right">Tutar</th></tr>
            ${tahsilatSatirlari || '<tr><td colspan="5" class="center">Kayıt yok</td></tr>'}
          </table>
        </div>

        <div class="box">
          <div class="box-title">Çıkışlar (${(o.cikislar || []).length})</div>
          <table class="list">
            <tr><th>#</th><th>Kaynak</th><th>Açıklama</th><th>Yöntem</th><th class="right">Tutar</th></tr>
            ${cikisSatirlari || '<tr><td colspan="5" class="center">Kayıt yok</td></tr>'}
          </table>
        </div>

        <div class="box">
          <div class="box-title">İş Emirleri</div>
          <table class="kv">
            <tr><td>Bugün Açılan</td><td class="right">${guvenliMetin(o.isEmri.acilan)}</td></tr>
            <tr><td>Bugün Kapanan</td><td class="right">${guvenliMetin(o.isEmri.kapanan)}</td></tr>
            <tr><td>Hâlâ Açık (Toplam)</td><td class="right">${guvenliMetin(o.isEmri.acikToplam)}</td></tr>
          </table>
        </div>
      </body>
    </html>
  `)
  pencere.document.close()
  pencere.focus()
  setTimeout(() => {
    pencere.print()
  }, 300)
}

const genelYenileme = genelVeriYenilemeIsleyicisi(veriYukle)

onMounted(() => {
  veriYukle()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div class="daily-closing-page">
    <div class="page-header">
      <div>
        <h2>Gün Sonu <HelpButton konu="gun-sonu" /></h2>
        <p>Günün tahsilat ve çıkış özeti, kasa sayımı ve günlük kapanış kaydı.</p>
      </div>

      <div class="header-actions">
        <input
          type="date"
          v-model="seciliTarih"
          class="p-inputtext date-input"
          :max="bugun"
          @change="tarihDegisti"
        />
        <Button
          label="Yenile"
          icon="pi pi-refresh"
          severity="secondary"
          :loading="yukleniyor"
          @click="veriYukle"
        />
        <Button
          label="Yazdır"
          icon="pi pi-print"
          severity="secondary"
          :disabled="!ozet"
          @click="raporYazdir"
        />
        <Button
          v-if="ozet && !kapanis && !gelecekTarih"
          label="Günü Kapat"
          icon="pi pi-lock"
          severity="danger"
          size="large"
          class="top-close-button"
          :loading="kapatiliyor"
          :disabled="destekModu"
          @click="gunuKapat"
        />
      </div>
    </div>

    <DestekModuUyarisi aciklama="Gün sonu kapatma destek modunda kapalıdır; günü yeniden açma açıktır." />

    <!-- Kapanış Durum Bandı -->
    <div v-if="kapanis" class="closed-banner">
      <i class="pi pi-lock"></i>
      <span>
        <strong>{{ tarihFormatla(kapanis.closing_date) }}</strong> günü kapatıldı —
        Kapatan: <strong>{{ kapanis.master_name || kapanis.closed_by_name || '-' }}</strong>,
        Saat: {{ tarihSaatFormatla(kapanis.created_at) }}
      </span>
      <span v-if="kapanis.cash_difference !== null" class="fark-badge" :style="{ color: farkRenk(kapanis.cash_difference) }">
        Kasa Farkı: {{ tlFormatla(kapanis.cash_difference) }}
      </span>
    </div>

    <template v-if="ozet">
      <!-- Özet Kartları -->
      <div class="stats-grid">
        <div class="stat-box" style="border-left: 4px solid #10b981;">
          <div class="stat-info">
            <h3 style="color: #10b981;">{{ tlFormatla(ozet.toplamTahsilat) }}</h3>
            <span>Toplam Tahsilat ({{ ozet.tahsilatlar.length }} işlem)</span>
          </div>
        </div>

        <div class="stat-box" style="border-left: 4px solid #ef4444;">
          <div class="stat-info">
            <h3 style="color: #ef4444;">{{ tlFormatla(ozet.toplamCikis) }}</h3>
            <span>Toplam Çıkış ({{ ozet.cikislar.length }} işlem)</span>
          </div>
        </div>

        <div class="stat-box" style="border-left: 4px solid #38bdf8;">
          <div class="stat-info">
            <h3 style="color: #38bdf8;">{{ tlFormatla(ozet.beklenenNakit) }}</h3>
            <span>Beklenen Nakit (Gün İçi)</span>
          </div>
        </div>

        <div class="stat-box" style="border-left: 4px solid #f59e0b;">
          <div class="stat-info">
            <h3 style="color: #f59e0b;">{{ ozet.isEmri.acilan }} / {{ ozet.isEmri.kapanan }} / {{ ozet.isEmri.acikToplam }}</h3>
            <span>İş Emri: Açılan / Kapanan / Hâlâ Açık</span>
          </div>
        </div>
      </div>

      <!-- Yöntem Kırılımı -->
      <div class="method-bar">
        <div class="method-chip">
          <i class="pi pi-money-bill" style="color: #10b981;"></i>
          <span>Nakit</span>
          <strong>{{ tlFormatla(ozet.yontemTahsilat.nakit) }}</strong>
        </div>
        <div class="method-chip">
          <i class="pi pi-credit-card" style="color: #38bdf8;"></i>
          <span>Kart</span>
          <strong>{{ tlFormatla(ozet.yontemTahsilat.kart) }}</strong>
        </div>
        <div class="method-chip">
          <i class="pi pi-building-columns" style="color: #a78bfa;"></i>
          <span>Havale / EFT</span>
          <strong>{{ tlFormatla(ozet.yontemTahsilat.havale) }}</strong>
        </div>
        <div class="method-chip">
          <i class="pi pi-ellipsis-h" style="color: var(--text-muted);"></i>
          <span>Diğer</span>
          <strong>{{ tlFormatla(ozet.yontemTahsilat.diger) }}</strong>
        </div>
      </div>

      <!-- Hareket Listeleri -->
      <div class="lists-grid">
        <div class="panel">
          <div class="panel-title">
            <i class="pi pi-arrow-down-left" style="color: #10b981;"></i>
            Tahsilatlar
          </div>
          <DataTable :value="ozet.tahsilatlar" size="small" :rows="8" :paginator="ozet.tahsilatlar.length > 8" scrollable>
            <template #empty>
              <div class="empty-mini">Bu tarihte tahsilat kaydı yok.</div>
            </template>
            <Column field="kaynak" header="Kaynak" style="width: 110px;" />
            <Column field="aciklama" header="Açıklama" />
            <Column field="yontem" header="Yöntem" style="width: 110px;" />
            <Column header="Tutar" style="width: 120px;">
              <template #body="slotProps">
                <span style="color: #10b981; font-weight: 600;">{{ tlFormatla(slotProps.data.tutar) }}</span>
              </template>
            </Column>
          </DataTable>
        </div>

        <div class="panel">
          <div class="panel-title">
            <i class="pi pi-arrow-up-right" style="color: #ef4444;"></i>
            Çıkışlar (Gider + Tedarikçi Ödemesi)
          </div>
          <DataTable :value="ozet.cikislar" size="small" :rows="8" :paginator="ozet.cikislar.length > 8" scrollable>
            <template #empty>
              <div class="empty-mini">Bu tarihte çıkış kaydı yok.</div>
            </template>
            <Column field="kaynak" header="Kaynak" style="width: 140px;" />
            <Column field="aciklama" header="Açıklama" />
            <Column field="yontem" header="Yöntem" style="width: 110px;" />
            <Column header="Tutar" style="width: 120px;">
              <template #body="slotProps">
                <span style="color: #ef4444; font-weight: 600;">{{ tlFormatla(slotProps.data.tutar) }}</span>
              </template>
            </Column>
          </DataTable>
        </div>
      </div>

      <!-- Kapanış Paneli -->
      <div v-if="kapanis" class="panel closing-panel closed">
        <div class="panel-title">
          <i class="pi pi-lock" style="color: #f59e0b;"></i>
          Kapanış Kaydı (Kilitli)
          <Button
            label="Günü Yeniden Aç"
            icon="pi pi-lock-open"
            severity="warn"
            outlined
            size="small"
            style="margin-left: auto;"
            @click="acilisDialogunuAc"
          />
        </div>
        <div class="closing-grid">
          <div class="kv"><span>Toplam Tahsilat</span><strong>{{ tlFormatla(kapanis.total_collected) }}</strong></div>
          <div class="kv"><span>Nakit</span><strong>{{ tlFormatla(kapanis.cash_total) }}</strong></div>
          <div class="kv"><span>Kart</span><strong>{{ tlFormatla(kapanis.card_total) }}</strong></div>
          <div class="kv"><span>Havale / EFT</span><strong>{{ tlFormatla(kapanis.transfer_total) }}</strong></div>
          <div class="kv"><span>Toplam Çıkış</span><strong>{{ tlFormatla(kapanis.total_out) }}</strong></div>
          <div class="kv"><span>Beklenen Nakit</span><strong>{{ tlFormatla(kapanis.expected_cash) }}</strong></div>
          <div class="kv"><span>Sayılan Nakit</span><strong>{{ kapanis.counted_cash === null ? 'Girilmedi' : tlFormatla(kapanis.counted_cash) }}</strong></div>
          <div class="kv">
            <span>Kasa Farkı</span>
            <strong :style="{ color: farkRenk(kapanis.cash_difference) }">
              {{ kapanis.cash_difference === null ? '-' : tlFormatla(kapanis.cash_difference) }}
            </strong>
          </div>
        </div>
        <div v-if="kapanis.note" class="closing-note">
          <i class="pi pi-comment"></i> {{ kapanis.note }}
        </div>
      </div>

      <div v-else-if="!gelecekTarih" class="panel closing-panel">
        <div class="panel-title">
          <i class="pi pi-lock-open" style="color: #38bdf8;"></i>
          Günü Kapat
        </div>
        <p class="closing-hint">
          Kasadaki nakiti sayıp aşağıya girin. Beklenen nakit ile fark otomatik hesaplanır.
          Kasa sayımı yapmadan da günü kapatabilirsiniz.
        </p>

        <div class="closing-form">
          <div class="form-field">
            <label>Beklenen Nakit</label>
            <div class="expected-cash">{{ tlFormatla(ozet.beklenenNakit) }}</div>
          </div>

          <div class="form-field">
            <label>Sayılan Nakit (₺)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              v-model="sayilanNakit"
              class="p-inputtext"
              placeholder="Örn: 12500"
            />
          </div>

          <div class="form-field">
            <label>Kasa Farkı</label>
            <div class="expected-cash" :style="{ color: farkRenk(nakitFarki) }">
              {{ nakitFarki === null ? '-' : tlFormatla(nakitFarki) }}
            </div>
          </div>
        </div>

        <div class="form-field" style="margin-top: 12px;">
          <label>Not {{ farkVar ? '(fark olduğu için zorunlu)' : '(isteğe bağlı)' }}</label>
          <Textarea
            v-model="kapanisNotu"
            rows="2"
            style="width: 100%;"
            :placeholder="farkVar ? 'Farkın nedenini yazın...' : 'Gün hakkında not...'"
          />
        </div>

      </div>
    </template>

    <div v-else-if="!yukleniyor" class="empty-state">
      <i class="pi pi-calendar"></i>
      <h3>Veri Yok</h3>
      <p>Seçilen tarih için gün sonu verisi alınamadı.</p>
    </div>

    <!-- Günü Yeniden Aç Dialogu -->
    <Dialog
      v-model:visible="acilisDialogAcik"
      header="Günü Yeniden Aç"
      modal
      :style="{ width: '380px' }"
    >
      <div class="reopen-dialog-body">
        <p class="reopen-warning">
          <i class="pi pi-exclamation-triangle"></i>
          <strong>{{ tarihFormatla(seciliTarih) }}</strong> gününün kapanış kaydı silinecek.
          Gün üzerinde düzeltme yaptıktan sonra günü yeniden kapatmanız gerekir.
        </p>

        <div class="form-field">
          <label>Neden (zorunlu, geçmişe kaydedilir)</label>
          <Textarea
            v-model="acilisNedeni"
            rows="2"
            style="width: 100%;"
            placeholder="Örn: Kasa sayımı hatalı girildi, düzeltilecek..."
            autofocus
          />
        </div>

        <div class="form-field">
          <label>Admin PIN</label>
          <InputText
            :value="adminPinGirisi"
            type="password"
            maxlength="4"
            inputmode="numeric"
            data-enter-handled="true"
            placeholder="4 haneli Admin PIN"
            style="width: 100%;"
            @input="adminPinDuzenle"
            @keyup.enter="gunuYenidenAc"
          />
        </div>
      </div>

      <template #footer>
        <Button label="Vazgeç" severity="secondary" text @click="acilisDialogAcik = false" />
        <Button
          label="Kaydı Sil ve Aç"
          icon="pi pi-lock-open"
          severity="danger"
          :loading="acilisYukleniyor"
          @click="gunuYenidenAc"
        />
      </template>
    </Dialog>

    <!-- Geçmiş Kapanışlar -->
    <div class="panel" style="margin-top: 20px;">
      <div class="panel-title">
        <i class="pi pi-history" style="color: var(--text-muted);"></i>
        Geçmiş Kapanışlar
      </div>
      <DataTable :value="gecmisKapanislar" size="small" :rows="10" :paginator="gecmisKapanislar.length > 10">
        <template #empty>
          <div class="empty-mini">Henüz kapanış kaydı yok.</div>
        </template>
        <Column header="Tarih" style="width: 110px;">
          <template #body="slotProps">
            <a class="date-link" @click.prevent="seciliTarih = slotProps.data.closing_date; tarihDegisti()">
              {{ tarihFormatla(slotProps.data.closing_date) }}
            </a>
          </template>
        </Column>
        <Column header="Tahsilat">
          <template #body="slotProps">{{ tlFormatla(slotProps.data.total_collected) }}</template>
        </Column>
        <Column header="Nakit">
          <template #body="slotProps">{{ tlFormatla(slotProps.data.cash_total) }}</template>
        </Column>
        <Column header="Çıkış">
          <template #body="slotProps">{{ tlFormatla(slotProps.data.total_out) }}</template>
        </Column>
        <Column header="Sayılan Nakit">
          <template #body="slotProps">
            {{ slotProps.data.counted_cash === null ? '-' : tlFormatla(slotProps.data.counted_cash) }}
          </template>
        </Column>
        <Column header="Kasa Farkı">
          <template #body="slotProps">
            <span :style="{ color: farkRenk(slotProps.data.cash_difference), fontWeight: 600 }">
              {{ slotProps.data.cash_difference === null ? '-' : tlFormatla(slotProps.data.cash_difference) }}
            </span>
          </template>
        </Column>
        <Column header="Kapatan">
          <template #body="slotProps">{{ slotProps.data.master_name || slotProps.data.closed_by_name || '-' }}</template>
        </Column>
      </DataTable>
    </div>

    <!-- Yeniden Açma Geçmişi -->
    <div class="panel" style="margin-top: 20px;">
      <div class="panel-title">
        <i class="pi pi-lock-open" style="color: #f59e0b;"></i>
        Yeniden Açma Geçmişi
      </div>
      <DataTable :value="yenidenAcmaLoglari" size="small" :rows="10" :paginator="yenidenAcmaLoglari.length > 10">
        <template #empty>
          <div class="empty-mini">Henüz yeniden açma kaydı yok.</div>
        </template>
        <Column header="Gün" style="width: 110px;">
          <template #body="slotProps">
            <a class="date-link" @click.prevent="seciliTarih = slotProps.data.closing_date; tarihDegisti()">
              {{ tarihFormatla(slotProps.data.closing_date) }}
            </a>
          </template>
        </Column>
        <Column header="Açan">
          <template #body="slotProps">{{ slotProps.data.master_name || slotProps.data.reopened_by_name || '-' }}</template>
        </Column>
        <Column header="Açılma Zamanı" style="width: 150px;">
          <template #body="slotProps">{{ tarihSaatFormatla(slotProps.data.created_at) }}</template>
        </Column>
        <Column header="Neden">
          <template #body="slotProps">{{ slotProps.data.reason }}</template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.daily-closing-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.top-close-button {
  min-height: 46px;
  padding-inline: 22px;
  font-weight: 800;
}

.date-input {
  height: 38px;
  padding: 0 10px;
}

.closed-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.07);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: var(--text-primary);
  font-size: 13px;
}

.closed-banner i {
  color: #f59e0b;
}

.fark-badge {
  margin-left: auto;
  font-weight: 700;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 14px;
}

.stat-box h3 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
}

.stat-box span {
  color: var(--text-muted);
  font-size: 13px;
}

.method-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.method-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.method-chip strong {
  margin-left: auto;
  color: var(--text-title);
}

.lists-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 14px;
}

.panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px 16px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-title);
  margin-bottom: 10px;
}

.empty-mini {
  padding: 14px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.closing-panel.closed {
  border-color: rgba(245, 158, 11, 0.3);
}

.closing-hint {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--text-muted);
}

.closing-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.expected-cash {
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border-color);
  font-weight: 700;
  color: var(--text-title);
}

.closing-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.closing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color-soft, var(--border-color));
  border-radius: 8px;
  padding: 8px 12px;
}

.kv span {
  font-size: 11px;
  color: var(--text-muted);
}

.kv strong {
  font-size: 14px;
  color: var(--text-title);
}

.closing-note {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.date-link {
  color: var(--accent-color, #38bdf8);
  cursor: pointer;
  font-weight: 600;
}

.date-link:hover {
  text-decoration: underline;
}

.reopen-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.reopen-warning {
  margin: 0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: rgba(245, 158, 11, 0.07);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
}

.reopen-warning i {
  color: #f59e0b;
  margin-top: 2px;
}
</style>
