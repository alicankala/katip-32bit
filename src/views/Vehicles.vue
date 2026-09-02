<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { decodeVin } from '../utils/vinDecoder'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

const araclar = ref([])
const yukleniyor = ref(true)
const musterilerListesi = ref([]) // Açılır menü için müşterileri tutar
const dialogAcik = ref(false)
const aramaKelimesi = ref('')
const toast = useToast()
const confirmDialog = useConfirm()

// Araç kaydı usta işidir; destek (admin) oturumu değiştiremez.
const { destekModu, destekModundaEngelle } = useYetki()
const router = useRouter()

const yeniAracAc = () => {
  if (destekModundaEngelle(toast, 'Araç ekleme destek modunda yapılamaz.')) return

  Object.assign(form, {
    id: null, customer_id: null, plate: '', brand: '', model: '',
    year: null, mileage: null, chassis: ''
  })
  dialogAcik.value = true
}

const yardimaGit = (konu) => router.push({ path: '/help', query: { konu } })
const servisKabuleGit = () => router.push('/service-reception')

const basariMesaji = (detay) => {
  toast.add({
    severity: 'success',
    summary: 'Başarılı',
    detail: detay,
    life: 2500
  })
}

const hataMesaji = (detay) => {
  toast.add({
    severity: 'error',
    summary: 'Hata',
    detail: detay,
    life: 4000
  })
}

const uyariMesaji = (detay) => {
  toast.add({
    severity: 'warn',
    summary: 'Uyarı',
    detail: detay,
    life: 3000
  })
}

const form = reactive({
  id: null,
  customer_id: null,
  plate: '',
  brand: '',
  model: '',
  year: null,
  mileage: null,
  chassis: ''
})

const saseDetayMetni = computed(() => {
  if (!form.chassis || form.chassis.length < 3) return ''
  const decoded = decodeVin(form.chassis)
  if (!decoded) return ''
  
  let parts = []
  if (decoded.brand) parts.push(`Marka: ${decoded.brand}`)
  if (decoded.country) parts.push(`Ülke: ${decoded.country}`)
  if (decoded.year) parts.push(`Yıl: ${decoded.year}`)
  
  if (form.chassis.length === 17) {
    if (decoded.isValidChecksum) {
      parts.push('✅ Şasi Doğrulandı')
    } else if (decoded.checksumApplies) {
      parts.push('⚠️ Geçersiz Şasi Kontrol Basamağı')
    } else {
      parts.push('✅ Şasi Formatı Geçerli')
    }
  }
  return parts.join(' | ')
})

watch(() => form.chassis, (yeniSase) => {
  if (!yeniSase) return
  
  const temizSase = yeniSase.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '')
  if (temizSase !== yeniSase) {
    form.chassis = temizSase
  }
  
  if (temizSase.length >= 17) {
    const saseBilgisi = decodeVin(temizSase)
    if (saseBilgisi) {
      if (saseBilgisi.brand && !form.brand) {
        form.brand = saseBilgisi.brand
      }
      if (saseBilgisi.year && !form.year) {
        form.year = saseBilgisi.year
      }
    }
  }
})

watch(() => form.plate, (yeniPlaka) => {
  if (!yeniPlaka) return
  
  const temizPlaka = yeniPlaka.toUpperCase().replace(/\s/g, '')
  if (temizPlaka !== yeniPlaka) {
    form.plate = temizPlaka
  }
})

const listeleriGetir = async () => {
  yukleniyor.value = true
  try {
    araclar.value = await window.api.araclariGetir()
    musterilerListesi.value = await window.api.musterileriGetir()
  } finally {
    yukleniyor.value = false
  }
}
const kmFormatla = (deger) => {
  if (deger === null || deger === undefined || deger === '') return '-'

  return Number(deger).toLocaleString('tr-TR')
}
const filtrelenmisAraclar = computed(() => {
  if (!aramaKelimesi.value) return araclar.value
  
  const aranan = aramaKelimesi.value.toLowerCase()

  return araclar.value.filter(a => 
    (a.plate || '').toLowerCase().includes(aranan) || 
    (a.customer_name || '').toLowerCase().includes(aranan) ||
    (a.brand || '').toLowerCase().includes(aranan) ||
(a.model || '').toLowerCase().includes(aranan) ||
String(a.mileage || '').toLowerCase().includes(aranan) ||
(a.chassis || '').toLowerCase().includes(aranan)
  )
})
const duzenle = (arac) => {
  if (destekModundaEngelle(toast, 'Araç düzenleme destek modunda yapılamaz.')) return

  Object.assign(form, {
    id: arac.id,
    customer_id: arac.customer_id,
    plate: arac.plate,
    brand: arac.brand,
    model: arac.model,
    year: arac.year,
    mileage: arac.mileage ?? null,
    chassis: arac.chassis || ''
  })

  dialogAcik.value = true
}
const sil = (id) => {
  if (!id) return
  if (destekModundaEngelle(toast, 'Aracı pasife alma destek modunda yapılamaz.')) return

  confirmDialog.require({
    message: 'Bu aracı pasife almak istediğinize emin misiniz?',
    header: 'Araç Pasife Al',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Pasife Al',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-danger',
    rejectClass: 'p-button-secondary p-button-text',
    accept: async () => {
      const res = await window.api.aracSil(id)

      if (res?.success) {
        basariMesaji('Araç pasife alındı.')
        await listeleriGetir()
      } else {
        hataMesaji(res?.error || 'Araç pasife alınamadı.')
      }
    }
  })
}

const kaydet = async () => {
  if (destekModundaEngelle(toast, 'Araç kaydetme destek modunda yapılamaz.')) return

  if (!form.customer_id || !form.plate) {
    uyariMesaji('Müşteri seçimi ve plaka alanı zorunludur.')
    return
  }

  try {
    const temizVeri = JSON.parse(JSON.stringify(form))

    const res = form.id
      ? await window.api.aracGuncelle(temizVeri)
      : await window.api.aracEkle(temizVeri)

    if (res && res.success) {
      basariMesaji(form.id ? 'Araç güncellendi.' : 'Araç kaydedildi.')

      dialogAcik.value = false

Object.assign(form, {
  id: null,
  customer_id: null,
  plate: '',
  brand: '',
  model: '',
  year: null,
  mileage: null,
  chassis: ''
})

      await listeleriGetir()
    } else {
      hataMesaji(res?.error || 'Araç kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji(error instanceof Error ? error.message : String(error))
  }
}

const genelYenileme = genelVeriYenilemeIsleyicisi(listeleriGetir)

onMounted(() => {
  listeleriGetir()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2>Araç Yönetimi <HelpButton konu="arac" /></h2>
      
      <div style="display: flex; gap: 15px; align-items: center;">
        <span class="p-input-icon-left" style="width: 360px;">
          <i class="pi pi-search" />
          <InputText
            v-model="aramaKelimesi"
            placeholder="Plaka, Müşteri, Marka, Model veya Şase Ara..."
          />
        </span>
        <Button
  label="Yeni Araç Ekle"
  icon="pi pi-car"
  severity="warning"
  :disabled="destekModu"
  @click="yeniAracAc"
/>
      </div>
    </div>

    <DestekModuUyarisi aciklama="Araç ekleme, düzenleme ve pasife alma destek modunda kapalıdır." />

    <div class="table-panel">
      <DataTable :value="filtrelenmisAraclar" :loading="yukleniyor" responsiveLayout="scroll">
        <template #empty>
          <EmptyState
            v-if="aramaKelimesi"
            icon="pi pi-search-minus"
            title="Arama sonucu bulunamadı"
            :description="`&quot;${aramaKelimesi}&quot; ile eşleşen araç yok. Plakayı boşluksuz yazmayı deneyin.`"
            compact
          />
          <EmptyState
            v-else
            icon="pi pi-car"
            title="Henüz araç kaydı yok"
            description="Araçları buradan elle ekleyebilirsiniz. Genelde buna gerek kalmaz: Servis Kabul ekranında yeni bir plaka girdiğinizde araç kaydı kendiliğinden açılır."
            action-label="Servis Kabul'e Git"
            action-icon="pi pi-bolt"
            hint-label="Nasıl yapılır?"
            :action-disabled="destekModu"
            @action="servisKabuleGit"
            @hint="yardimaGit('arac')"
          />
        </template>

        <Column field="plate" header="Plaka"></Column>
        <Column field="customer_name" header="Araç Sahibi"></Column>
        <Column field="brand" header="Marka"></Column>
        <Column field="model" header="Model"></Column>
<Column field="year" header="Yıl"></Column>

<Column header="Güncel KM">
  <template #body="slotProps">
    {{ kmFormatla(slotProps.data.mileage) }}
  </template>
</Column>

<Column field="chassis" header="Şase No"></Column>
        <Column header="İşlem" :exportable="false" style="min-width:8rem">
          <template #body="slotProps">
            <Button 
  icon="pi pi-pencil" 
  outlined 
  rounded 
  severity="info" 
  :disabled="destekModu"
  @click="duzenle(slotProps.data)" 
  style="margin-right: 8px;" 
/>
            <Button icon="pi pi-trash" outlined rounded severity="danger" :disabled="destekModu" @click="sil(slotProps.data.id)" />
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialogAcik" :header="form.id ? 'Araç Düzenle' : 'Yeni Araç Kaydı'" :style="{ width: '450px' }" modal>
      <div style="display: flex; flex-direction: column; gap: 15px; padding-top: 10px;">
        
        <div class="form-group">
          <label>Araç Sahibi (Müşteri Seçin)</label>
          <Dropdown v-model="form.customer_id" :options="musterilerListesi" optionLabel="name" optionValue="id" placeholder="Müşteri Seçiniz..." style="width: 100%" filter />
        </div>

        <div class="form-group">
          <label>Plaka</label>
          <InputText v-model="form.plate" placeholder="Örn: 06ABC123" style="width: 100%; text-transform: uppercase;" @keydown.space.prevent autofocus />
        </div>

        <div style="display: flex; gap: 10px;">
          <div class="form-group" style="flex: 1;">
            <label>Marka</label>
            <InputText v-model="form.brand" placeholder="Örn: Ford" style="width: 100%" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Model</label>
            <InputText v-model="form.model" placeholder="Örn: Focus" style="width: 100%" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Yıl</label>
            <InputText type="number" v-model="form.year" placeholder="2015" style="width: 100%" />
          </div>
        </div>

        <div class="form-group">
  <label>Güncel KM</label>
  <InputText
    type="number"
    v-model="form.mileage"
    placeholder="Örn: 185000"
    style="width: 100%"
  />
</div>

        <div class="form-group">
          <label>Şase Numarası</label>
          <InputText 
            v-model="form.chassis" 
            placeholder="Örn: VF1xxxxxxxxxxxxx" 
            style="width: 100%" 
          />
          <small v-if="saseDetayMetni" style="color: var(--text-muted, #94a3b8); margin-top: 2px; font-size: 0.78rem;">
            {{ saseDetayMetni }}
          </small>
        </div>

      </div>
      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="dialogAcik = false" />
        <Button label="Kaydet" icon="pi pi-check" :disabled="destekModu" @click="kaydet" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.form-group label {
  font-size: 0.95rem;
  color: var(--text-secondary);
}
</style>
