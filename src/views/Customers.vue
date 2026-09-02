<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import EmptyState from '../components/EmptyState.vue'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

const musteriler = ref([])
const yukleniyor = ref(true)
const dialogAcik = ref(false)
const aramaKelimesi = ref('')

const toast = useToast()
const confirmDialog = useConfirm()

// Müşteri kaydı usta işidir; destek (admin) oturumu değiştiremez.
const { destekModu, destekModundaEngelle } = useYetki()
const router = useRouter()

const yeniMusteriAc = () => {
  if (destekModundaEngelle(toast, 'Müşteri ekleme destek modunda yapılamaz.')) return

  Object.assign(form, { id: null, name: '', phone: '', note: '' })
  dialogAcik.value = true
}

const yardimaGit = (konu) => router.push({ path: '/help', query: { konu } })

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
  id: null, // Güncelleme için eklendi
  name: '',
  phone: '',
  note: ''
})

const listeyiGetir = async () => {
  yukleniyor.value = true
  try {
    musteriler.value = await window.api.musterileriGetir()
  } finally {
    yukleniyor.value = false
  }
}

const filtrelenmisMusteriler = computed(() => {
  if (!aramaKelimesi.value) return musteriler.value
  
  const aranan = aramaKelimesi.value.toLowerCase()
  return musteriler.value.filter(m => 
    (m.name || '').toLowerCase().includes(aranan) || 
    (m.phone || '').toLowerCase().includes(aranan)
  )
})

const sil = (id) => {
  if (!id) return
  if (destekModundaEngelle(toast, 'Müşteri pasife alma destek modunda yapılamaz.')) return

  confirmDialog.require({
    message: 'Bu müşteriyi pasife almak istediğinize emin misiniz?',
    header: 'Müşteri Pasife Al',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Pasife Al',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-danger',
    rejectClass: 'p-button-secondary p-button-text',
    accept: async () => {
      const res = await window.api.musteriSil(id)

      if (res?.success) {
        basariMesaji('Müşteri pasife alındı.')
        await listeyiGetir()
      } else {
        hataMesaji(res?.error || 'Müşteri pasife alınamadı.')
      }
    }
  })
}
const duzenle = (musteri) => {
  if (destekModundaEngelle(toast, 'Müşteri düzenleme destek modunda yapılamaz.')) return

  Object.assign(form, { id: musteri.id, name: musteri.name, phone: musteri.phone, note: musteri.note })
  dialogAcik.value = true
}
const kaydet = async () => {
  if (destekModundaEngelle(toast, 'Müşteri kaydetme destek modunda yapılamaz.')) return

  if (!form.name) {
    uyariMesaji('Ad/Soyad alanı zorunludur.')
    return
  }

  try {
    const temizVeri = JSON.parse(JSON.stringify(form))

    const res = form.id
      ? await window.api.musteriGuncelle(temizVeri)
      : await window.api.musteriEkle(temizVeri)

    if (res && res.success) {
      basariMesaji(form.id ? 'Müşteri güncellendi.' : 'Müşteri kaydedildi.')

      dialogAcik.value = false

      Object.assign(form, {
        id: null,
        name: '',
        phone: '',
        note: ''
      })

      await listeyiGetir()
    } else {
      hataMesaji(res?.error || 'İşlem yapılamadı.')
    }
  } catch (error) {
    hataMesaji(error instanceof Error ? error.message : String(error))
  }
}
const genelYenileme = genelVeriYenilemeIsleyicisi(listeyiGetir)

onMounted(() => {
  listeyiGetir()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2>Müşteri Yönetimi <HelpButton konu="musteri" /></h2>
      
      <div style="display: flex; gap: 15px; align-items: center;">
        <span class="p-input-icon-left" style="width: 300px;">
          <i class="pi pi-search" />
          <InputText v-model="aramaKelimesi" placeholder="İsim veya Telefon Ara..." />
        </span>
        <Button label="Yeni Müşteri Ekle" icon="pi pi-user-plus" severity="info" :disabled="destekModu" @click="yeniMusteriAc" />
      </div>
    </div>

    <DestekModuUyarisi aciklama="Müşteri ekleme, düzenleme ve pasife alma destek modunda kapalıdır." />

    <div class="table-panel">
      <!-- alwaysShowPaginator=false: liste tek sayfaya sığıyorsa sayfalama
           çubuğu görünmez, yani az kayıtlı kurulumlarda görüntü değişmez. -->
      <DataTable
        :value="filtrelenmisMusteriler"
        :loading="yukleniyor"
        responsiveLayout="scroll"
        paginator
        :rows="50"
        :alwaysShowPaginator="false"
      >
        <template #empty>
          <EmptyState
            v-if="aramaKelimesi"
            icon="pi pi-search-minus"
            title="Arama sonucu bulunamadı"
            :description="`&quot;${aramaKelimesi}&quot; ile eşleşen müşteri yok. Arama kutusunu temizleyip yeniden deneyin.`"
            compact
          />
          <EmptyState
            v-else
            icon="pi pi-users"
            title="Henüz müşteri kaydı yok"
            description="Müşteriyi buradan elle ekleyebilirsiniz. Servis Kabul ekranından araç aldığınızda müşteri kaydı zaten kendiliğinden oluşur."
            action-label="Yeni Müşteri Ekle"
            action-icon="pi pi-user-plus"
            hint-label="Nasıl yapılır?"
            :action-disabled="destekModu"
            @action="yeniMusteriAc"
            @hint="yardimaGit('musteri')"
          />
        </template>

        <Column field="name" header="Ad Soyad"></Column>
        <Column field="phone" header="Telefon Numarası"></Column>
        <Column field="note" header="Müşteri Notu"></Column>
        <Column header="İşlem" :exportable="false" style="min-width:8rem">
          <template #body="slotProps">
            <Button icon="pi pi-pencil" outlined rounded severity="info" :disabled="destekModu" @click="duzenle(slotProps.data)" style="margin-right: 8px;" />
            <Button icon="pi pi-trash" outlined rounded severity="danger" :disabled="destekModu" @click="sil(slotProps.data.id)" />
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog
  v-model:visible="dialogAcik"
  :header="form.id ? 'Müşteri Düzenle' : 'Yeni Müşteri Kaydı'"
  :style="{ width: '400px' }"
  modal
>
      <div style="display: flex; flex-direction: column; gap: 15px; padding-top: 10px;">
        
        <div class="form-group">
          <label>Ad Soyad</label>
          <InputText v-model="form.name" placeholder="Örn: Alican Kala" style="width: 100%" autofocus />
        </div>

        <div class="form-group">
          <label>Telefon Numarası</label>
          <InputText v-model="form.phone" placeholder="Örn: 0555 123 45 67" style="width: 100%" />
        </div>

        <div class="form-group">
          <label>Özel Not / Açıklama</label>
          <InputText v-model="form.note" placeholder="Örn: Sürekli Müşteri / Titiz" style="width: 100%" />
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
