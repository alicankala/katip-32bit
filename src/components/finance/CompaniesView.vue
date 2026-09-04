<script setup>
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import EmptyState from '../EmptyState.vue'
import { useFormatters } from '../../composables/useFormatters'

const props = defineProps({
  accounts: {
    type: Array,
    default: () => []
  },
  destekModu: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['edit-account', 'select-account'])
const { tlFormatla } = useFormatters()
const aramaMetni = ref('')

const firmalar = computed(() => {
  const aranan = String(aramaMetni.value || '').trim().toLocaleLowerCase('tr-TR')
  return props.accounts
    .filter((cari) => (cari.direction || 'Borç') === 'Borç')
    .filter((cari) => {
      if (!aranan) return true
      return [cari.name, cari.type, cari.phone, cari.note]
        .some((alan) => String(alan || '').toLocaleLowerCase('tr-TR').includes(aranan))
    })
})
</script>

<template>
  <div class="companies-view">
    <div class="companies-toolbar">
      <div>
        <h3>Firma ve Kişi Listesi</h3>
        <p>Tedarikçi ve taşeron bilgilerini görüntüleyin veya düzenleyin.</p>
      </div>
      <span class="p-input-icon-left company-search">
        <i class="pi pi-search" />
        <InputText v-model="aramaMetni" placeholder="Firma, tür veya telefon ara..." />
      </span>
    </div>

    <DataTable
      :value="firmalar"
      paginator
      :rows="15"
      responsiveLayout="scroll"
      class="p-datatable-sm"
    >
      <template #empty>
        <EmptyState
          icon="pi pi-building"
          :title="aramaMetni ? 'Aramayla eşleşen firma yok' : 'Henüz firma kaydı yok'"
          :description="aramaMetni ? 'Arama metnini değiştirip yeniden deneyin.' : 'Borç eklerken oluşturulan firmalar burada listelenir.'"
          compact
        />
      </template>

      <Column field="name" header="Firma / Kişi Adı">
        <template #body="slotProps">
          <strong class="company-name">{{ slotProps.data.name }}</strong>
        </template>
      </Column>

      <Column field="type" header="Tür" style="width: 160px;">
        <template #body="slotProps">{{ slotProps.data.type || '-' }}</template>
      </Column>

      <Column field="phone" header="Telefon" style="width: 150px;">
        <template #body="slotProps">{{ slotProps.data.phone || '-' }}</template>
      </Column>

      <Column header="Kalan Bakiye" style="width: 150px; text-align: right;">
        <template #body="slotProps">
          <strong :class="Number(slotProps.data.remaining_debt || 0) > 0.01 ? 'debt' : 'settled'">
            {{ tlFormatla(slotProps.data.remaining_debt) }}
          </strong>
        </template>
      </Column>

      <Column header="İşlemler" style="width: 190px; text-align: center;">
        <template #body="slotProps">
          <div class="company-actions">
            <Button
              label="Detay"
              icon="pi pi-history"
              size="small"
              severity="secondary"
              outlined
              @click="emit('select-account', slotProps.data)"
            />
            <Button
              label="Düzenle"
              icon="pi pi-pencil"
              size="small"
              severity="info"
              outlined
              :disabled="destekModu"
              @click="emit('edit-account', slotProps.data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.companies-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--bg-panel, #1e293b);
  border: 1px solid var(--border-color, #334155);
  border-radius: 12px;
}

.companies-toolbar,
.company-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.companies-toolbar {
  flex-wrap: wrap;
}

.companies-toolbar h3 {
  margin: 0;
  color: var(--text-title);
  font-size: 1rem;
}

.companies-toolbar p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.company-search {
  min-width: 280px;
}

.company-search :deep(input) {
  width: 100%;
}

.company-name {
  color: var(--text-title);
}

.debt {
  color: #f87171;
}

.settled {
  color: #34d399;
}

.company-actions {
  justify-content: center;
  gap: 6px;
}

@media (max-width: 640px) {
  .company-search {
    width: 100%;
    min-width: 0;
  }
}
</style>

