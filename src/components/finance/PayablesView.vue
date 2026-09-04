<script setup>
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Checkbox from 'primevue/checkbox'
import { useFormatters } from '../../composables/useFormatters'
import EmptyState from '../EmptyState.vue'

const props = defineProps({
  suppliers: {
    type: Array,
    default: () => []
  },
  supplierTypes: {
    type: Array,
    default: () => []
  },
  // Destek (Admin) oturumunda kayıt oluşturan düğmeler pasiftir; bkz. composables/useYetki.js
  destekModu: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'add-debt',
  'select-cari',
  'add-transaction',
  'add-payment',
  'edit-cari',
  'delete-cari'
])

const aramaMetni = ref('')
const seciliTipFiltresi = ref(null)
const sadeceBorclular = ref(true)

const filtrelenmisTedarikciler = computed(() => {
  // Sadece Tedarikçi/Taşeron Borç yönlü cariler
  let list = props.suppliers.filter(c => (c.direction || 'Borç') === 'Borç')

  // Arama filtresi
  if (aramaMetni.value.trim()) {
    const q = aramaMetni.value.toLowerCase().trim()
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.note || '').toLowerCase().includes(q)
    )
  }

  // Tip filtresi
  if (seciliTipFiltresi.value) {
    list = list.filter(c => c.type === seciliTipFiltresi.value)
  }

  // Sadece Borçlu Olanlar
  if (sadeceBorclular.value) {
    list = list.filter(c => Number(c.remaining_debt || 0) > 0.01)
  }

  return list
})

const { tlFormatla } = useFormatters()

const getCariTipClass = (type) => {
  if (!type) return 'diğer'
  const t = type.toLowerCase()
  if (t.includes('parça')) return 'parçacı'
  if (t.includes('kaporta')) return 'kaportacı'
  if (t.includes('boya')) return 'boyacı'
  if (t.includes('turbo')) return 'turbocu'
  if (t.includes('rektefiye')) return 'rektefiyeci'
  if (t.includes('torna')) return 'tornacı'
  if (t.includes('elektrik')) return 'elektrikçi'
  if (t.includes('egzoz')) return 'egzozcu'
  if (t.includes('döşeme')) return 'döşemeci'
  return 'diğer'
}
</script>

<template>
  <div class="payables-view panel" style="display: flex; flex-direction: column; gap: 16px; background: var(--bg-panel, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 20px;">
    <!-- Üst Kontrol & Filtre Barları -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <span class="p-input-icon-left" style="min-width: 220px;">
          <i class="pi pi-search" />
          <InputText v-model="aramaMetni" placeholder="Tedarikçi / Taşeron Ara..." />
        </span>

        <Dropdown
          v-model="seciliTipFiltresi"
          :options="supplierTypes"
          showClear
          placeholder="Cari Tipi Filtrele"
          style="width: 170px;"
        />

        <div style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
          <Checkbox v-model="sadeceBorclular" :binary="true" inputId="sadeceBorcluCheck" />
          <label for="sadeceBorcluCheck" style="font-size: 0.85rem; color: var(--text-secondary, #cbd5e1); cursor: pointer;">
            Sadece Borcumuz Olanlar
          </label>
        </div>
      </div>

      <Button
        label="Yeni Borç Ekle"
        icon="pi pi-plus"
        severity="danger"
        size="small"
        :disabled="destekModu"
        @click="emit('add-debt')"
      />
    </div>

    <!-- Veri Tablosu -->
    <DataTable
      :value="filtrelenmisTedarikciler"
      responsiveLayout="scroll"
      paginator
      :rows="15"
      class="p-datatable-sm"
    >
      <template #empty>
        <EmptyState
          v-if="aramaMetni || seciliTipFiltresi || sadeceBorclular"
          icon="pi pi-search-minus"
          title="Bu süzgeçte kayıt yok"
          description="Arama kutusunu, tür seçimini veya 'sadece borçlular' işaretini kaldırıp yeniden bakın."
          compact
        />
        <EmptyState
          v-else
          icon="pi pi-truck"
          title="Henüz borç kaydı yok"
          description="Kişi veya firma adını elle yazabilir ya da geçmiş kayıtlarınızdan seçerek ilk borcunuzu ekleyebilirsiniz."
          action-label="Yeni Borç Ekle"
          action-icon="pi pi-plus"
          compact
          :action-disabled="destekModu"
          @action="emit('add-debt')"
        />
      </template>

      <Column field="name" header="Firma / Kişi Adı">
        <template #body="slotProps">
          <strong>{{ slotProps.data.name }}</strong>
        </template>
      </Column>

      <Column field="type" header="Cari Tipi" style="width: 140px;">
        <template #body="slotProps">
          <span 
            class="direction-badge"
            :class="getCariTipClass(slotProps.data.type)"
          >
            {{ slotProps.data.type }}
          </span>
        </template>
      </Column>

      <Column field="phone" header="Telefon" style="width: 130px;"></Column>

      <Column header="Toplam İşlem" style="text-align: right; width: 130px;">
        <template #body="slotProps">
          {{ tlFormatla(slotProps.data.total_debt) }}
        </template>
      </Column>

      <Column header="Yapılan Ödeme" style="text-align: right; width: 130px;">
        <template #body="slotProps">
          <span style="color: #34d399; font-weight: 600;">{{ tlFormatla(slotProps.data.total_paid) }}</span>
        </template>
      </Column>

      <Column header="Kalan Borcumuz" style="text-align: right; width: 140px;">
        <template #body="slotProps">
          <strong style="color: #f87171;">{{ tlFormatla(slotProps.data.remaining_debt) }}</strong>
        </template>
      </Column>

      <Column header="İşlemler" style="text-align: center; width: 275px;">
        <template #body="slotProps">
          <div style="display: flex; gap: 4px; justify-content: center;">
            <Button
              label="Detay"
              icon="pi pi-history"
              size="small"
              severity="secondary"
              outlined
              title="Geçmiş Hareketler"
              @click="emit('select-cari', slotProps.data)"
            />
            <Button
              label="Borç Ekle"
              icon="pi pi-plus"
              size="small"
              severity="danger"
              title="Borç Ekle"
              :disabled="destekModu"
              @click="emit('add-transaction', slotProps.data)"
            />
            <Button
              label="Öde"
              icon="pi pi-check"
              size="small"
              severity="success"
              title="Ödeme Yap"
              :disabled="destekModu"
              @click="emit('add-payment', slotProps.data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>
