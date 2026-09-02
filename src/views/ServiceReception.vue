<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, computed } from 'vue'
import { decodeVin } from '../utils/vinDecoder'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

const router = useRouter()
const toast = useToast()
const { destekModu, destekModundaEngelle } = useYetki()

const musteriler = ref([])
const araclar = ref([])
const kaydediliyor = ref(false)
const aktifUsta = ref(null)
const bulunanArac = ref(null)

const form = reactive({
  musteriAd: '',
  musteriTel: '',
  plaka: '',
  marka: '',
  model: '',
  yil: '',
  sase: '',
  km: '',
  sikayet: ''
})

const verileriYukle = async () => {
  musteriler.value = await window.api.musterileriGetir()
  araclar.value = await window.api.araclariGetir()
  plakaKontrolEt()
}

const formuTemizle = () => {
  Object.assign(form, {
    musteriAd: '',
    musteriTel: '',
    plaka: '',
    marka: '',
    model: '',
    yil: '',
    sase: '',
    km: '',
    sikayet: ''
  })

  bulunanArac.value = null
}

const telefonTemizle = (telefon) => {
  return String(telefon || '').replace(/\s+/g, '').trim()
}

const plakaTemizle = (plaka) => {
  return String(plaka || '').trim().toUpperCase().replace(/\s+/g, '')
}

const mevcutMusteriBul = () => {
  const tel = telefonTemizle(form.musteriTel)
  const ad = String(form.musteriAd || '').trim().toLowerCase()

  if (tel) {
    const telIleBulunan = musteriler.value.find(m =>
      telefonTemizle(m.phone) === tel
    )

    if (telIleBulunan) return telIleBulunan
  }

  if (ad) {
    return musteriler.value.find(m =>
      String(m.name || '').trim().toLowerCase() === ad
    )
  }

  return null
}

const mevcutAracBul = () => {
  const plaka = plakaTemizle(form.plaka)

  return araclar.value.find(a =>
    plakaTemizle(a.plate) === plaka
  )
}

const plakaKontrolEt = () => {
  const plaka = plakaTemizle(form.plaka)

  if (!plaka) {
    bulunanArac.value = null
    return
  }

  const mevcutArac = mevcutAracBul()

  if (!mevcutArac) {
    bulunanArac.value = null
    return
  }

  bulunanArac.value = mevcutArac

  form.musteriAd = mevcutArac.customer_name || ''
  form.musteriTel = mevcutArac.customer_phone || ''
  form.plaka = mevcutArac.plate || form.plaka
  form.marka = mevcutArac.brand || ''
  form.model = mevcutArac.model || ''
  form.yil = mevcutArac.year || ''
  form.sase = mevcutArac.chassis || ''
  form.km = mevcutArac.mileage || ''
}

watch(
  () => form.plaka,
  (yeniPlaka) => {
    if (!yeniPlaka) return
    const temizPlaka = yeniPlaka.toUpperCase().replace(/\s/g, '')
    if (temizPlaka !== yeniPlaka) {
      form.plaka = temizPlaka
    }
    plakaKontrolEt()
  }
)

const saseDetayMetni = computed(() => {
  if (!form.sase || form.sase.length < 3) return ''
  const decoded = decodeVin(form.sase)
  if (!decoded) return ''
  
  let parts = []
  if (decoded.brand) parts.push(`Marka: ${decoded.brand}`)
  if (decoded.country) parts.push(`Ülke: ${decoded.country}`)
  if (decoded.year) parts.push(`Yıl: ${decoded.year}`)
  
  if (form.sase.length === 17) {
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

watch(() => form.sase, (yeniSase) => {
  if (!yeniSase) return
  
  const temizSase = yeniSase.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '')
  if (temizSase !== yeniSase) {
    form.sase = temizSase
  }
  
  if (temizSase.length >= 17) {
    const saseBilgisi = decodeVin(temizSase)
    if (saseBilgisi) {
      if (saseBilgisi.brand && !form.marka) {
        form.marka = saseBilgisi.brand
      }
      if (saseBilgisi.year && !form.yil) {
        form.yil = saseBilgisi.year
      }
    }
  }
})

const serviseAl = async () => {
  // Destek modu bir usta oturumu değildir; iş emrinin sahibi belirsiz kalırdı.
  if (destekModundaEngelle(toast, 'Servis kabul ve iş emri açma destek modunda yapılamaz.')) return

  const aktifUstaBilgisi =
    aktifUsta.value || JSON.parse(localStorage.getItem('aktifUsta') || 'null')

  if (!aktifUstaBilgisi?.id) {
    toast.add({
      severity: 'warn',
      summary: 'Usta Girişi Gerekli',
      detail: 'İş emri açmak için önce usta girişi yapılmalıdır.',
      life: 3000
    })
    return
  }

  if (!form.musteriAd || !form.plaka) {
    toast.add({
      severity: 'warn',
      summary: 'Eksik Bilgi',
      detail: 'Müşteri adı ve plaka zorunludur.',
      life: 3000
    })
    return
  }

  kaydediliyor.value = true

  try {
    await verileriYukle()

    const mevcutArac = mevcutAracBul()
    let vehicleId = mevcutArac?.id || null

    if (!vehicleId) {
      let customerId = null
      const mevcutMusteri = mevcutMusteriBul()

      if (mevcutMusteri) {
        customerId = mevcutMusteri.id
      } else {
        const musteriRes = await window.api.musteriEkle({
          name: form.musteriAd,
          phone: form.musteriTel,
          note: 'Servis kabulden oluşturuldu'
        })

        if (!musteriRes?.success) {
          throw new Error(musteriRes?.error || 'Müşteri oluşturulamadı.')
        }

        customerId = musteriRes.id
      }

      const aracRes = await window.api.aracEkle({
        customer_id: customerId,
        plate: plakaTemizle(form.plaka),
        brand: form.marka,
        model: form.model,
        year: form.yil || null,
        mileage: form.km || null,
        chassis: form.sase
      })

      if (!aracRes?.success) {
        throw new Error(aracRes?.error || 'Araç oluşturulamadı.')
      }

      vehicleId = aracRes.id
    } else {
      // Araç zaten kayıtlı, müşteri ve araç bilgilerindeki değişiklikleri denetle ve güncelle
      let customerId = null
      const mevcutMusteri = mevcutMusteriBul()

      if (mevcutMusteri) {
        customerId = mevcutMusteri.id
        
        // Müşteri bilgileri formda güncellenmişse veritabanında da güncelle
        const trimmedName = String(form.musteriAd || '').trim()
        const trimmedPhone = String(form.musteriTel || '').trim()
        if (mevcutMusteri.name !== trimmedName || mevcutMusteri.phone !== trimmedPhone) {
          const musteriGuncelleRes = await window.api.musteriGuncelle({
            id: customerId,
            name: trimmedName,
            phone: trimmedPhone,
            note: mevcutMusteri.note || 'Servis kabulden güncellendi'
          })
          if (!musteriGuncelleRes?.success) {
            throw new Error(musteriGuncelleRes?.error || 'Müşteri bilgileri güncellenemedi.')
          }
        }
      } else {
        // Yeni bir müşteri bilgisi girildiyse (Araç sahibi değişmişse)
        const musteriRes = await window.api.musteriEkle({
          name: form.musteriAd,
          phone: form.musteriTel,
          note: 'Servis kabulden (yeni sahibi) oluşturuldu'
        })

        if (!musteriRes?.success) {
          throw new Error(musteriRes?.error || 'Yeni araç sahibi oluşturulamadı.')
        }

        customerId = musteriRes.id
      }

      // Araç bilgilerinde değişiklik var mı kontrol et
      const plateChanged = plakaTemizle(form.plaka) !== plakaTemizle(mevcutArac.plate)
      const brandChanged = String(form.marka || '').trim() !== String(mevcutArac.brand || '').trim()
      const modelChanged = String(form.model || '').trim() !== String(mevcutArac.model || '').trim()
      const yearChanged = (form.yil ? Number(form.yil) : null) !== (mevcutArac.year ? Number(mevcutArac.year) : null)
      const chassisChanged = String(form.sase || '').trim() !== String(mevcutArac.chassis || '').trim()
      const mileageChanged = (form.km ? Number(form.km) : null) !== (mevcutArac.mileage ? Number(mevcutArac.mileage) : null)
      const customerChanged = customerId !== mevcutArac.customer_id

      if (plateChanged || brandChanged || modelChanged || yearChanged || chassisChanged || mileageChanged || customerChanged) {
        const aracGuncelleRes = await window.api.aracGuncelle({
          id: vehicleId,
          customer_id: customerId,
          plate: plakaTemizle(form.plaka),
          brand: form.marka,
          model: form.model,
          year: form.yil || null,
          mileage: form.km || null,
          chassis: form.sase
        })

        if (!aracGuncelleRes?.success) {
          throw new Error(aracGuncelleRes?.error || 'Araç bilgileri güncellenemedi.')
        }
      }
    }

const isEmriRes = await window.api.isEmriEkle({
  vehicle_id: vehicleId,
  description: form.sikayet,
  mileage: form.km,
  total_price: 0,
  status: 'Açık',
  active_master_id: aktifUstaBilgisi.id
})

    if (!isEmriRes?.success) {
      throw new Error(isEmriRes?.error || 'İş emri oluşturulamadı.')
    }

    toast.add({
      severity: 'success',
      summary: 'Servis Kabul Oluşturuldu',
      detail: 'Araç servise alındı ve iş emri açıldı.',
      life: 2500
    })

    formuTemizle()
    await verileriYukle()

    router.push('/work-orders')
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Servis Kabul Hatası',
      detail: error instanceof Error ? error.message : String(error),
      life: 5000
    })
  } finally {
    kaydediliyor.value = false
  }
}

const genelYenileme = genelVeriYenilemeIsleyicisi(verileriYukle)

onMounted(() => {
  aktifUsta.value = JSON.parse(localStorage.getItem('aktifUsta') || 'null')
  verileriYukle()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div class="page servis-kabul-page">
    <div class="page-header">
      <div>
<h1 class="page-title">Servis Kabul <HelpButton konu="servis-kabul" /></h1>

<p class="page-subtitle">
  Müşteri geldiğinde müşteri, araç ve şikâyet bilgilerini tek ekrandan girip iş emri açın.
</p>

<p
  v-if="aktifUsta"
  class="active-master-text"
>
  Aktif Usta: <strong>{{ aktifUsta.name }}</strong>
</p>
      </div>
    </div>

    <DestekModuUyarisi aciklama="Servis kabul ve iş emri açma destek modunda kapalıdır." />

    <div class="reception-layout">
      <div class="panel reception-panel">
        <div class="form-section-title">
          <i class="pi pi-user"></i>
          Müşteri Bilgileri
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Müşteri Ad Soyad *</label>
            <InputText
              v-model="form.musteriAd"
              placeholder="Örn: Ahmet Yılmaz"
              autofocus
            />
          </div>

          <div class="form-group">
            <label>Telefon</label>
            <InputText
              v-model="form.musteriTel"
              placeholder="Örn: 0555 123 45 67"
            />
          </div>
        </div>

        <div class="form-section-title">
          <i class="pi pi-car"></i>
          Araç Bilgileri
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Plaka *</label>
<InputText
  v-model="form.plaka"
  placeholder="Örn: 34ABC123"
  style="text-transform: uppercase;"
  @keydown.space.prevent
  @blur="plakaKontrolEt"
/>
<div
  v-if="bulunanArac"
  class="existing-vehicle-box"
>
  <strong>Kayıtlı araç bulundu.</strong>
  <span>
    {{ bulunanArac.customer_name || '-' }}
    -
    {{ bulunanArac.brand || '-' }} {{ bulunanArac.model || '' }}
  </span>
</div>
          </div>

          <div class="form-group">
            <label>Marka</label>
            <InputText
              v-model="form.marka"
              placeholder="Örn: Ford"
            />
          </div>
        </div>

<div class="form-row">
  <div class="form-group">
    <label>Model</label>
    <InputText
      v-model="form.model"
      placeholder="Örn: Focus"
    />
  </div>

  <div class="form-group">
    <label>Model Yılı</label>
    <InputText
      v-model="form.yil"
      type="number"
      placeholder="Örn: 2016"
    />
  </div>
</div>

<div class="form-row">
  <div class="form-group">
    <label>Şase Numarası</label>
    <InputText
      v-model="form.sase"
      placeholder="Örn: VF1xxxxxxxxxxxxx"
    />
    <small v-if="saseDetayMetni" style="color: var(--text-muted, #94a3b8); margin-top: 2px; font-size: 0.78rem;">
      {{ saseDetayMetni }}
    </small>
  </div>

  <div class="form-group">
    <label>Kilometre</label>
    <InputText
      v-model="form.km"
      type="number"
      placeholder="Örn: 185000"
    />
  </div>
</div>


        <div class="form-section-title">
          <i class="pi pi-wrench"></i>
          Servis Bilgileri
        </div>

        <div class="form-group">
          <label>Müşteri Şikayeti / Yapılacak İşlem</label>
          <Textarea
            v-model="form.sikayet"
            rows="5"
            placeholder="Örn: Araçtan ses geliyor, yağ bakımı yapılacak..."
          />
        </div>

        <div class="actions">
          <Button
            label="Temizle"
            icon="pi pi-refresh"
            severity="secondary"
            outlined
            :disabled="kaydediliyor"
            @click="formuTemizle"
          />

          <Button
            label="Servise Al ve İş Emri Aç"
            icon="pi pi-check"
            severity="success"
            :loading="kaydediliyor"
            :disabled="destekModu"
            @click="serviseAl"
          />
        </div>
      </div>

      <div class="panel help-panel">
        <h2>Nasıl çalışır?</h2>

        <p>
          <strong>Plakayı yazarken:</strong> Harfler büyütülür, boşluklar silinir.
          Plaka kayıtlıysa müşteri ve araç bilgileri forma otomatik doldurulur.
          Şasinin 17 hanesi girildiğinde marka ile yıl boşsa şasiden tamamlanır.
        </p>

        <p>
          <strong>Plaka kayıtlıysa:</strong> Mevcut araç kullanılır. Müşteri adını
          veya telefonunu değiştirdiyseniz müşteri kaydı da güncellenir, araç
          bilgilerindeki değişiklikler araca işlenir. Tanınmayan bir müşteri
          girdiyseniz araç yeni sahibine aktarılır.
        </p>

        <p>
          <strong>Plaka kayıtlı değilse:</strong> Müşteri önce telefondan, telefon
          eşleşmezse birebir aynı isimden aranır. Bulunursa araç o müşteriye
          bağlanır, bulunamazsa yeni müşteri kaydı açılır. Ardından araç
          oluşturulur.
        </p>

        <p>
          Her iki durumda da sonunda <strong>“Açık”</strong> durumunda yeni bir iş
          emri açılır ve İş Emirleri ekranına geçilir.
        </p>

        <div class="hint-box">
          <strong>Zorunlu:</strong>
          <br />
          Usta girişi, müşteri adı ve plaka.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.servis-kabul-page {
  color: var(--text-primary);
}

.reception-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 20px;
  align-items: start;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-group label {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
}

.form-group :deep(input),
.form-group :deep(textarea) {
  width: 100%;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.help-panel h2 {
  margin: 0 0 14px;
  color: var(--text-title);
  font-size: 18px;
  font-weight: 700;
}

.help-panel p {
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
  font-size: 14.5px;
}

.hint-box {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-color);
  border-radius: 8px;
  padding: 14px 16px;
  color: var(--text-primary);
  margin-top: 18px;
  font-size: 14.5px;
  line-height: 1.5;
}

.active-master-text {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 14.5px;
}

.active-master-text strong {
  color: var(--text-title);
}

.existing-vehicle-box {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: var(--status-ok);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.existing-vehicle-box strong {
  color: var(--text-title);
  font-size: 14px;
  font-weight: 700;
}

.existing-vehicle-box span {
  color: var(--text-secondary);
  font-size: 14px;
}

@media (max-width: 1100px) {
  .reception-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}

:global(html[data-theme="light"] .hint-box) {
  background: #f8fafc !important;
  border-color: #c8d5e3 !important;
  border-left-color: #2563eb !important;
  color: #0f172a !important;
}
:global(html[data-theme="light"] .existing-vehicle-box) {
  background: #f0fdf4 !important;
  border-color: #22c55e !important;
  color: #166534 !important;
}
:global(html[data-theme="light"] .existing-vehicle-box strong) { color: #14532d !important; }
:global(html[data-theme="light"] .existing-vehicle-box span)   { color: #166534 !important; }
</style>
