<script setup>
import { useFormatters } from '../../composables/useFormatters'

defineProps({
  summary: {
    type: Object,
    required: true
  },
  profitability: {
    type: Object,
    default: () => ({
      toplamSatis: 0,
      toplamMaliyet: 0,
      netKar: 0,
      karOrani: 0
    })
  }
})

const emit = defineEmits(['navigate'])

const { tlFormatla } = useFormatters()
</script>

<template>
  <div class="finance-summary-container" style="display: flex; flex-direction: column; gap: 20px;">
    <!-- 4 Temel İstatistik Kartı -->
    <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px;">
      <!-- 1. Toplam Müşteri Alacağı -->
      <div class="stat-box clickable" @click="emit('navigate', 'alacaklar')" style="border-left: 4px solid #10b981; cursor: pointer;">
        <div class="stat-info">
          <h3 style="color: #10b981; font-size: 1.8rem; font-weight: 700; margin: 0;">{{ tlFormatla(summary.totalReceivables) }}</h3>
          <span style="color: var(--text-muted, #94a3b8); font-size: 14px;">Toplam Müşteri Alacağı</span>
        </div>
        <div class="stat-icon-wrapper green" style="background: rgba(16, 185, 129, 0.1); color: #10b981; padding: 10px; border-radius: 8px;">
          <i class="pi pi-car" style="font-size: 1.4rem;" />
        </div>
      </div>

      <!-- 2. Toplam Borç -->
      <div class="stat-box clickable" @click="emit('navigate', 'borclar')" style="border-left: 4px solid #ef4444; cursor: pointer;">
        <div class="stat-info">
          <h3 style="color: #ef4444; font-size: 1.8rem; font-weight: 700; margin: 0;">{{ tlFormatla(summary.totalPayables) }}</h3>
          <span style="color: var(--text-muted, #94a3b8); font-size: 14px;">Toplam Tedarikçi Borcu</span>
        </div>
        <div class="stat-icon-wrapper red" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 10px; border-radius: 8px;">
          <i class="pi pi-arrow-up-right" style="font-size: 1.4rem;" />
        </div>
      </div>

      <!-- 3. Ödenmemiş Gider -->
      <div class="stat-box clickable" @click="emit('navigate', 'giderler')" style="border-left: 4px solid #f59e0b; cursor: pointer;">
        <div class="stat-info">
          <h3 style="color: #f59e0b; font-size: 1.8rem; font-weight: 700; margin: 0;">{{ tlFormatla(summary.unpaidExpenses) }}</h3>
          <span style="color: var(--text-muted, #94a3b8); font-size: 14px;">Ödenmemiş Giderler</span>
        </div>
        <div class="stat-icon-wrapper yellow" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; padding: 10px; border-radius: 8px;">
          <i class="pi pi-receipt" style="font-size: 1.4rem;" />
        </div>
      </div>

      <!-- 4. Bu Ay Tahsil Edilen -->
      <div class="stat-box clickable" @click="emit('navigate', 'tum-hareketler')" style="border-left: 4px solid #38bdf8; cursor: pointer;">
        <div class="stat-info">
          <h3 style="color: #38bdf8; font-size: 1.8rem; font-weight: 700; margin: 0;">{{ tlFormatla(summary.currentMonthCollections) }}</h3>
          <span style="color: var(--text-muted, #94a3b8); font-size: 14px;">Bu Ay Tahsil Edilen</span>
        </div>
        <div class="stat-icon-wrapper blue" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; padding: 10px; border-radius: 8px;">
          <i class="pi pi-wallet" style="font-size: 1.4rem;" />
        </div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div>
          <strong style="display: block; color: var(--text-title, #fff);">Bu Ay Kârlılık</strong>
          <span style="font-size: 0.8rem; color: var(--text-muted, #94a3b8);">Tamamlanan iş emirlerine göre</span>
        </div>
        <button
          type="button"
          style="border: 0; padding: 0; background: transparent; color: #34d399; cursor: pointer; font-weight: 700;"
          @click="emit('navigate', 'karlilik')"
        >
          Ayrıntıları Aç <i class="pi pi-arrow-right" />
        </button>
      </div>

      <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
        <div class="stat-box clickable" style="border-left: 4px solid #38bdf8; cursor: pointer;" @click="emit('navigate', 'karlilik')">
          <div class="stat-info">
            <h3 style="color: #38bdf8; font-size: 1.35rem; font-weight: 700; margin: 0;">{{ tlFormatla(profitability.toplamSatis) }}</h3>
            <span style="color: var(--text-muted, #94a3b8); font-size: 13px;">Toplam Satış</span>
          </div>
        </div>
        <div class="stat-box clickable" style="border-left: 4px solid #f59e0b; cursor: pointer;" @click="emit('navigate', 'karlilik')">
          <div class="stat-info">
            <h3 style="color: #f59e0b; font-size: 1.35rem; font-weight: 700; margin: 0;">{{ tlFormatla(profitability.toplamMaliyet) }}</h3>
            <span style="color: var(--text-muted, #94a3b8); font-size: 13px;">Toplam Maliyet</span>
          </div>
        </div>
        <div class="stat-box clickable" style="border-left: 4px solid #10b981; cursor: pointer;" @click="emit('navigate', 'karlilik')">
          <div class="stat-info">
            <h3 :style="{ color: profitability.netKar >= 0 ? '#10b981' : '#ef4444', fontSize: '1.35rem', fontWeight: 700, margin: 0 }">{{ tlFormatla(profitability.netKar) }}</h3>
            <span style="color: var(--text-muted, #94a3b8); font-size: 13px;">Net Kâr</span>
          </div>
        </div>
        <div class="stat-box clickable" style="border-left: 4px solid #a855f7; cursor: pointer;" @click="emit('navigate', 'karlilik')">
          <div class="stat-info">
            <h3 style="color: #a855f7; font-size: 1.35rem; font-weight: 700; margin: 0;">%{{ Number(profitability.karOrani || 0).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}</h3>
            <span style="color: var(--text-muted, #94a3b8); font-size: 13px;">Kâr Oranı</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Alt Anlaşılır Özet Paneli -->
    <div class="quick-summary-bar" style="background: var(--bg-panel, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 16px 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(16, 185, 129, 0.1); display: flex; align-items: center; justify-content: center; color: #10b981;">
          <i class="pi pi-clock" style="font-size: 1.2rem;" />
        </div>
        <div>
          <div style="font-size: 1.2rem; font-weight: 700; color: var(--text-title, #fff);">{{ summary.openWorkOrderCount }} Kayıt</div>
          <div style="font-size: 0.82rem; color: var(--text-muted, #94a3b8);">Açık İş Emri Alacağı</div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(239, 68, 68, 0.1); display: flex; align-items: center; justify-content: center; color: #ef4444;">
          <i class="pi pi-users" style="font-size: 1.2rem;" />
        </div>
        <div>
          <div style="font-size: 1.2rem; font-weight: 700; color: var(--text-title, #fff);">{{ summary.debtorCariCount }} Tedarikçi</div>
          <div style="font-size: 0.82rem; color: var(--text-muted, #94a3b8);">Borçlu Olduğumuz Cari</div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(245, 158, 11, 0.1); display: flex; align-items: center; justify-content: center; color: #f59e0b;">
          <i class="pi pi-exclamation-circle" style="font-size: 1.2rem;" />
        </div>
        <div>
          <div style="font-size: 1.2rem; font-weight: 700; color: var(--text-title, #fff);">{{ summary.unpaidExpenseCount }} Kalem</div>
          <div style="font-size: 0.82rem; color: var(--text-muted, #94a3b8);">Ödenmemiş İşletme Gideri</div>
        </div>
      </div>
    </div>
  </div>
</template>
