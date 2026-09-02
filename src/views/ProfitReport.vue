<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dropdown from 'primevue/dropdown'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import { useFormatters } from '../composables/useFormatters'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'
import HelpButton from '../components/HelpButton.vue'

const rapor = ref([])
const giderler = ref([])
const cariler = ref([])
const yukleniyor = ref(false)
const aramaKelimesi = ref('')
const durumFiltresi = ref('Tümü')
const durumSecenekleri = ref(['Tümü', 'Açık', 'Beklemede', 'Tamamlandı'])

const baslangicTarihi = ref('')
const bitisTarihi = ref('')

const raporuGetir = async () => {
  yukleniyor.value = true

  try {
    const res = await window.api.karlilikRaporuGetir()
    if (res?.success) {
      rapor.value = Array.isArray(res.rapor) ? res.rapor : []
    } else {
      rapor.value = []
      console.error(res?.error || 'Kârlılık raporu getirilemedi.')
    }

    const gidRes = await window.api.giderleriGetir()
    if (gidRes?.success) {
      giderler.value = Array.isArray(gidRes.giderler) ? gidRes.giderler : []
    } else {
      giderler.value = []
    }

    const cariRes = await window.api.cariHesapleriGetir()
    if (cariRes?.success) {
      const accounts = Array.isArray(cariRes.accounts) ? cariRes.accounts : []
      for (const acc of accounts) {
        const txRes = await window.api.cariIslemleriGetir(acc.id)
        acc.transactions = txRes?.success ? txRes.transactions : []

        const pmRes = await window.api.cariOdemeleriGetir(acc.id)
        acc.payments = pmRes?.success ? pmRes.payments : []
      }
      cariler.value = accounts
    } else {
      cariler.value = []
    }
  } catch (error) {
    console.error('Kârlılık raporu hatası:', error)
    rapor.value = []
    giderler.value = []
    cariler.value = []
  } finally {
    yukleniyor.value = false
  }
}

const filtrelenmisRapor = computed(() => {
  let liste = rapor.value

  if (durumFiltresi.value !== 'Tümü') {
    liste = liste.filter((satir) => satir.status === durumFiltresi.value)
  }

  if (baslangicTarihi.value) {
    const bas = baslangicTarihi.value
    liste = liste.filter((satir) => {
      const t = satir.closed_at ? satir.closed_at.substring(0, 10) : satir.created_at.substring(0, 10);
      return t >= bas;
    });
  }

  if (bitisTarihi.value) {
    const bit = bitisTarihi.value
    liste = liste.filter((satir) => {
      const t = satir.closed_at ? satir.closed_at.substring(0, 10) : satir.created_at.substring(0, 10);
      return t <= bit;
    });
  }

  if (!aramaKelimesi.value) return liste

  const aranan = aramaKelimesi.value.toLowerCase()

  return liste.filter((satir) =>
    String(satir.id || '').includes(aranan) ||
    String(satir.plate || '').toLowerCase().includes(aranan) ||
    String(satir.customer_name || '').toLowerCase().includes(aranan) ||
    String(satir.brand || '').toLowerCase().includes(aranan) ||
    String(satir.model || '').toLowerCase().includes(aranan)
  )
})

const ozet = computed(() => {
  let toplamGelir = 0
  let toplamMaliyet = 0
  let netKar = 0
  let tamamlanan = 0

  for (const satir of filtrelenmisRapor.value) {
    toplamGelir += Number(satir.toplam_gelir || 0)
    toplamMaliyet += Number(satir.toplam_maliyet || 0)
    netKar += Number(satir.net_kar || 0)

    if (satir.status === 'Tamamlandı') {
      tamamlanan += 1
    }
  }

  const karOrani = toplamGelir > 0 ? (netKar / toplamGelir) * 100 : 0

  return {
    isEmriSayisi: filtrelenmisRapor.value.length,
    tamamlanan,
    toplamGelir,
    toplamMaliyet,
    netKar,
    karOrani
  }
})

const giderOzeti = computed(() => {
  let odenmis = 0
  let odenmemis = 0
  
  const liste = giderler.value.filter((g) => {
    const t = g.expense_date ? g.expense_date.substring(0, 10) : '';
    if (baslangicTarihi.value && t < baslangicTarihi.value) return false;
    if (bitisTarihi.value && t > bitisTarihi.value) return false;
    return true;
  });

  for (const g of liste) {
    const amt = Number(g.amount || 0);
    if (g.status === 'Ödendi') {
      odenmis += amt;
    } else {
      odenmemis += amt;
    }
  }

  return {
    odenmis,
    odenmemis,
    toplam: odenmis + odenmemis
  };
})

const cariOzeti = computed(() => {
  let borclar = 0

  const hasDateFilter = !!(baslangicTarihi.value || bitisTarihi.value);

  for (const acc of cariler.value) {
    if ((acc.direction || 'Borç') !== 'Borç') continue

    let remaining = 0;
    if (hasDateFilter) {
      let debt = 0;
      const txs = acc.transactions || [];
      for (const tx of txs) {
        const t = tx.date ? tx.date.substring(0, 10) : '';
        if (baslangicTarihi.value && t < baslangicTarihi.value) continue;
        if (bitisTarihi.value && t > bitisTarihi.value) continue;
        debt += Number(tx.amount || 0);
      }

      let paid = 0;
      const pms = acc.payments || [];
      for (const pm of pms) {
        const t = pm.date ? pm.date.substring(0, 10) : '';
        if (baslangicTarihi.value && t < baslangicTarihi.value) continue;
        if (bitisTarihi.value && t > bitisTarihi.value) continue;
        paid += Number(pm.amount || 0);
      }

      remaining = debt - paid;
    } else {
      remaining = Number(acc.remaining_debt || 0);
    }

    if (remaining > 0) borclar += remaining;
  }

  return { borclar };
})

const { tlFormatla, tarihSaatFormatla: tarihFormatla } = useFormatters()

const yuzdeFormatla = (deger) => {
  return '%' + Number(deger || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
}

const getSeverity = (status) => {
  switch (status) {
    case 'Tamamlandı': return 'success'
    case 'Beklemede': return 'warn'
    case 'Açık': return 'danger'
    default: return 'info'
  }
}

const karSeverity = (netKar) => {
  if (Number(netKar || 0) > 0) return 'success'
  if (Number(netKar || 0) < 0) return 'danger'
  return 'secondary'
}

const genelYenileme = genelVeriYenilemeIsleyicisi(raporuGetir)

onMounted(() => {
  raporuGetir()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div class="profit-report-page">
    <div class="page-header">
      <div>
        <h2>İç Kâr Raporu <HelpButton konu="kar-raporu" /></h2>
        <p>Bu ekran sadece servis içi takip içindir. Müşteriye gösterilmez.</p>
      </div>

      <Button
        label="Yenile"
        icon="pi pi-refresh"
        severity="secondary"
        :loading="yukleniyor"
        @click="raporuGetir"
      />
    </div>

    <!-- Tarih Filtresi -->
    <div class="filter-panel card">
      <div class="filter-input-group">
        <span>Başlangıç Tarihi</span>
        <input type="date" v-model="baslangicTarihi" class="p-inputtext" />
      </div>
      <div class="filter-input-group">
        <span>Bitiş Tarihi</span>
        <input type="date" v-model="bitisTarihi" class="p-inputtext" />
      </div>
      <Button 
        label="Tarihleri Temizle" 
        icon="pi pi-filter-slash" 
        severity="secondary" 
        outlined 
        @click="baslangicTarihi = ''; bitisTarihi = ''" 
        style="height: 38px; align-self: flex-end;" 
      />
    </div>

    <!-- A) Servis Kâr Özeti -->
    <h3 class="finance-section-title">A) Servis Kâr Özeti</h3>
    <div class="summary-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="summary-card">
        <span>Toplam Satış</span>
        <strong>{{ tlFormatla(ozet.toplamGelir) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">İş emirlerindeki toplam gelir</small>
      </div>
      <div class="summary-card">
        <span>Toplam Maliyet</span>
        <strong>{{ tlFormatla(ozet.toplamMaliyet) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Yedek parça alış maliyetleri</small>
      </div>
      <div class="summary-card main">
        <span>Servis Kârı</span>
        <strong>{{ tlFormatla(ozet.netKar) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Satış - Maliyet</small>
      </div>
      <div class="summary-card">
        <span>Kâr Oranı</span>
        <strong>{{ yuzdeFormatla(ozet.karOrani) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Servis kârının ciroya oranı</small>
      </div>
    </div>

    <!-- B) Genel Gider Özeti -->
    <h3 class="finance-section-title">B) Genel Gider Özeti</h3>
    <div class="finance-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 20px;">
      <div class="summary-card">
        <span>Ödenmiş Giderler</span>
        <strong>{{ tlFormatla(giderOzeti.odenmis) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Kasadan ödenmiş harcamalar</small>
      </div>
      <div class="summary-card">
        <span>Ödenmemiş Giderler</span>
        <strong>{{ tlFormatla(giderOzeti.odenmemis) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Vadesi bekleyen faturalar vb.</small>
      </div>
      <div class="summary-card main" style="border-color: #fb923c;">
        <span>Toplam Gider</span>
        <strong>{{ tlFormatla(giderOzeti.toplam) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Ödenmiş + Ödenmemiş</small>
      </div>
    </div>

    <!-- C) Net İşletme Kârı -->
    <h3 class="finance-section-title">C) Net İşletme Kârı</h3>
    <div class="finance-grid" style="grid-template-columns: 1fr; margin-bottom: 20px;">
      <div class="summary-card main" :class="{ 'danger-card': ozet.netKar - giderOzeti.toplam < 0, 'success-card': ozet.netKar - giderOzeti.toplam >= 0 }" style="padding: 20px;">
        <span style="font-size: 15px; font-weight: 600;">Net İşletme Kârı (Servis Kârı - Toplam Gider)</span>
        <strong style="font-size: 32px; margin-top: 8px;">{{ tlFormatla(ozet.netKar - giderOzeti.toplam) }}</strong>
        <div style="font-size: 13px; opacity: 0.9; margin-top: 6px;">
          Formül: {{ tlFormatla(ozet.netKar) }} (Servis Kârı) - {{ tlFormatla(giderOzeti.toplam) }} (Toplam Genel Gider) = 
          <strong>{{ tlFormatla(ozet.netKar - giderOzeti.toplam) }}</strong>
        </div>
      </div>
    </div>

    <!-- D) Tedarikçi Borç Durumu -->
    <h3 class="finance-section-title">D) Tedarikçi Borç Durumu</h3>
    <div class="finance-grid" style="grid-template-columns: 1fr; margin-bottom: 20px;">
      <div class="summary-card main" style="border-color: #ef4444;">
        <span>Toplam Tedarikçi / Taşeron Borcu</span>
        <strong>{{ tlFormatla(cariOzeti.borclar) }}</strong>
        <small style="font-size: 11px; opacity: 0.85;">Ödeme yapacağımız kişi ve firmaların kalan toplamı</small>
      </div>
    </div>

    <!-- E) Genel Finans Özeti -->
    <h3 class="finance-section-title">E) Genel Finans Özeti</h3>
    <div class="finance-grid" style="grid-template-columns: 1fr; margin-bottom: 25px;">
      <div class="summary-card" style="border-left: 4px solid #38bdf8; padding: 20px; background: #1e293b; border-radius: 12px;">
        <h4 style="font-size: 15px; font-weight: 700; color: #38bdf8; margin: 0 0 14px 0; border: none; padding: 0;">
          İşletme Finansal Durum Değerlendirmesi
        </h4>
        
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13.5px; color: #cbd5e1; line-height: 1.5;">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <i class="pi pi-check-circle" style="color: #34d399; margin-top: 2px; font-size: 14px; flex-shrink: 0;" />
            <div>
              Servis faaliyetlerinden elde edilen <strong>{{ tlFormatla(ozet.toplamGelir) }}</strong> cirodan, 
              <strong>{{ tlFormatla(ozet.toplamMaliyet) }}</strong> parça maliyeti düşüldüğünde servis kârımız 
              <strong>{{ tlFormatla(ozet.netKar) }}</strong> olmuştur.
            </div>
          </div>
          
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <i class="pi pi-info-circle" style="color: #fb923c; margin-top: 2px; font-size: 14px; flex-shrink: 0;" />
            <div>
              Bu periyotta <strong>{{ tlFormatla(giderOzeti.toplam) }}</strong> genel gider (işletme masrafı) gerçekleşmiştir. 
              Bunun <strong>{{ tlFormatla(giderOzeti.odenmis) }}</strong> kısmı kasadan ödenmiş, <strong>{{ tlFormatla(giderOzeti.odenmemis) }}</strong> kısmı ise henüz ödenmemiştir.
            </div>
          </div>
          
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <i class="pi pi-chart-line" style="color: #38bdf8; margin-top: 2px; font-size: 14px; flex-shrink: 0;" />
            <div>
              Servis kârından toplam genel giderler düşüldüğünde net işletme kârımız 
              <strong :style="{ color: ozet.netKar - giderOzeti.toplam >= 0 ? '#34d399' : '#f87171' }">{{ tlFormatla(ozet.netKar - giderOzeti.toplam) }}</strong> seviyesindedir.
            </div>
          </div>
          
          <div style="display: flex; align-items: flex-start; gap: 10px; padding-top: 12px; border-top: 1px solid #334155; margin-top: 4px;">
            <i class="pi pi-wallet" style="color: #a855f7; margin-top: 2px; font-size: 14px; flex-shrink: 0;" />
            <div>
              Tedarikçi ve taşeron hesaplarında toplam <strong>{{ tlFormatla(cariOzeti.borclar) }}</strong> borcumuz bulunmaktadır.
              Müşteri alacakları iş emirlerine bağlı olarak Finans ekranındaki Alacaklar sekmesinde takip edilir.
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="table-panel">
      <div class="filter-row">
        <span class="p-input-icon-left" style="width: 320px;">
          <i class="pi pi-search" />
          <InputText
            v-model="aramaKelimesi"
            placeholder="İş emri, plaka, müşteri ara..."
          />
        </span>

        <Dropdown
          v-model="durumFiltresi"
          :options="durumSecenekleri"
          placeholder="Durum"
          style="width: 180px;"
        />
      </div>

      <DataTable
        :value="filtrelenmisRapor"
        :loading="yukleniyor"
        responsiveLayout="scroll"
        emptyMessage="Kârlılık raporu bulunamadı."
      >
        <Column field="id" header="İş Emri"></Column>

        <Column field="plate" header="Plaka"></Column>

        <Column field="customer_name" header="Müşteri"></Column>

        <Column header="Durum">
          <template #body="slotProps">
            <Tag
              :value="slotProps.data.status"
              :severity="getSeverity(slotProps.data.status)"
            />
          </template>
        </Column>

        <Column header="Açılış">
          <template #body="slotProps">
            {{ tarihFormatla(slotProps.data.created_at) }}
          </template>
        </Column>

        <Column header="Kapanış">
          <template #body="slotProps">
            {{ tarihFormatla(slotProps.data.closed_at) }}
          </template>
        </Column>

        <Column header="Parça Satış">
          <template #body="slotProps">
            {{ tlFormatla(slotProps.data.parca_satis_toplami) }}
          </template>
        </Column>

        <Column header="Parça Maliyet">
          <template #body="slotProps">
            {{ tlFormatla(slotProps.data.parca_maliyet_toplami) }}
          </template>
        </Column>

        <Column header="İşçilik">
          <template #body="slotProps">
            {{ tlFormatla(slotProps.data.iscilik_geliri) }}
          </template>
        </Column>

        <Column header="Toplam Gelir">
          <template #body="slotProps">
            <strong>{{ tlFormatla(slotProps.data.toplam_gelir) }}</strong>
          </template>
        </Column>

        <Column header="Toplam Maliyet">
          <template #body="slotProps">
            <strong>{{ tlFormatla(slotProps.data.toplam_maliyet) }}</strong>
          </template>
        </Column>

        <Column header="Net Kâr">
          <template #body="slotProps">
            <Tag
              :value="tlFormatla(slotProps.data.net_kar)"
              :severity="karSeverity(slotProps.data.net_kar)"
            />
          </template>
        </Column>

        <Column header="Kâr Oranı">
          <template #body="slotProps">
            {{ yuzdeFormatla(slotProps.data.kar_orani) }}
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.profit-report-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.page-header h2 {
  margin: 0;
  color: #ffffff;
}

.page-header p {
  margin: 6px 0 0;
  color: #94a3b8;
}

.filter-panel {
  display: flex;
  gap: 16px;
  align-items: center;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 16px;
  flex-wrap: wrap;
}

.filter-input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-input-group span {
  color: #94a3b8;
  font-size: 13px;
  font-weight: 500;
}

.filter-input-group input {
  width: 170px;
  background: #0f172a;
  border-color: #334155;
  color: #fff;
}

.finance-section-title {
  margin: 10px 0 4px 0;
  color: #38bdf8;
  font-size: 1.15rem;
  font-weight: 600;
  border-left: 3px solid #38bdf8;
  padding-left: 8px;
}

.finance-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.summary-card {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-card span {
  color: #94a3b8;
  font-size: 14px;
}

.summary-card strong {
  color: #e5e7eb;
  font-size: 22px;
}

.summary-card small {
  color: #cbd5e1;
}

.summary-card.main {
  border-color: #22c55e;
}

.summary-card.main.success-card {
  border-color: #22c55e;
}

.summary-card.main.danger-card {
  border-color: #ef4444;
}

.filter-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

:global(html[data-theme="light"] .page-header h2),
:global(html[data-theme="light"] .summary-card strong),
:global(html[data-theme="light"] .finance-section-title) {
  color: #111827 !important;
}

:global(html[data-theme="light"] .finance-section-title) {
  border-left-color: #0284c7 !important;
  color: #0284c7 !important;
}

:global(html[data-theme="light"] .page-header p),
:global(html[data-theme="light"] .summary-card span),
:global(html[data-theme="light"] .summary-card small),
:global(html[data-theme="light"] .filter-input-group span) {
  color: #374151 !important;
}

:global(html[data-theme="light"] .summary-card),
:global(html[data-theme="light"] .filter-panel) {
  background: #ffffff !important;
  border-color: #d1d5db !important;
}

:global(html[data-theme="light"] .filter-panel input) {
  background: #ffffff !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
}
</style>
