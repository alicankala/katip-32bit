<script setup>
import { computed } from 'vue'
import { useFormatters } from '../../composables/useFormatters'

const props = defineProps({
  summary: { type: Object, required: true },
  profitability: { type: Object, required: true },
  expenses: { type: Array, default: () => [] },
  payables: { type: Array, default: () => [] }
})

const emit = defineEmits(['navigate'])
const { tlFormatla, tarihFormatla } = useFormatters()

const tarihAnahtari = (tarih = new Date()) => {
  const yil = tarih.getFullYear()
  const ay = String(tarih.getMonth() + 1).padStart(2, '0')
  const gun = String(tarih.getDate()).padStart(2, '0')
  return `${yil}-${ay}-${gun}`
}

const bugun = tarihAnahtari()
const yediGunSonraTarihi = new Date()
yediGunSonraTarihi.setDate(yediGunSonraTarihi.getDate() + 7)
const yediGunSonra = tarihAnahtari(yediGunSonraTarihi)

const odenmemisGiderler = computed(() => props.expenses
  .filter((gider) => (gider.status || 'Ödenmedi') !== 'Ödendi')
  .slice()
  .sort((a, b) => String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31'))))

const oncelikliGiderler = computed(() => odenmemisGiderler.value.slice(0, 5))

const vadesiGecmisOzeti = computed(() => {
  const liste = odenmemisGiderler.value.filter((gider) => gider.due_date && gider.due_date < bugun)
  return {
    adet: liste.length,
    tutar: liste.reduce((toplam, gider) => toplam + Number(gider.amount || 0), 0)
  }
})

const yaklasanOdemeOzeti = computed(() => {
  const liste = odenmemisGiderler.value.filter((gider) => gider.due_date && gider.due_date >= bugun && gider.due_date <= yediGunSonra)
  return {
    adet: liste.length,
    tutar: liste.reduce((toplam, gider) => toplam + Number(gider.amount || 0), 0)
  }
})

const yuksekBorclar = computed(() => props.payables
  .filter((cari) => (cari.direction || 'Borç') === 'Borç' && Number(cari.remaining_debt || 0) > 0.01)
  .slice()
  .sort((a, b) => Number(b.remaining_debt || 0) - Number(a.remaining_debt || 0))
  .slice(0, 5))

const vadeEtiketi = (gider) => {
  if (!gider.due_date) return 'Vade girilmemiş'
  if (gider.due_date < bugun) return 'Vadesi geçti'
  if (gider.due_date === bugun) return 'Bugün'
  return tarihFormatla(gider.due_date)
}
</script>

<template>
  <div class="payment-overview">
    <section class="focus-panel">
      <div class="section-heading">
        <div>
          <h3>Ödeme Durumu</h3>
          <p>Öncelikle ilgilenmeniz gereken gider ve borçlar</p>
        </div>
        <div class="payment-load">
          <span>Toplam ödeme yükü</span>
          <strong>{{ tlFormatla(Number(summary.totalPayables || 0) + Number(summary.unpaidExpenses || 0)) }}</strong>
        </div>
      </div>

      <div class="stats-grid">
        <button type="button" class="stat-card debt" @click="emit('navigate', 'borclar')">
          <span class="stat-icon"><i class="pi pi-building" /></span>
          <span class="stat-copy">
            <small>Tedarikçi Borcu</small>
            <strong>{{ tlFormatla(summary.totalPayables) }}</strong>
            <em>{{ summary.debtorCariCount }} açık cari</em>
          </span>
        </button>
        <button type="button" class="stat-card expense" @click="emit('navigate', 'giderler')">
          <span class="stat-icon"><i class="pi pi-receipt" /></span>
          <span class="stat-copy">
            <small>Ödenmemiş Gider</small>
            <strong>{{ tlFormatla(summary.unpaidExpenses) }}</strong>
            <em>{{ summary.unpaidExpenseCount }} ödeme bekliyor</em>
          </span>
        </button>
        <button type="button" class="stat-card overdue" @click="emit('navigate', 'giderler')">
          <span class="stat-icon"><i class="pi pi-exclamation-triangle" /></span>
          <span class="stat-copy">
            <small>Vadesi Geçmiş</small>
            <strong>{{ tlFormatla(vadesiGecmisOzeti.tutar) }}</strong>
            <em>{{ vadesiGecmisOzeti.adet }} geciken ödeme</em>
          </span>
        </button>
        <button type="button" class="stat-card upcoming" @click="emit('navigate', 'giderler')">
          <span class="stat-icon"><i class="pi pi-calendar-clock" /></span>
          <span class="stat-copy">
            <small>7 Gün İçinde</small>
            <strong>{{ tlFormatla(yaklasanOdemeOzeti.tutar) }}</strong>
            <em>{{ yaklasanOdemeOzeti.adet }} yaklaşan ödeme</em>
          </span>
        </button>
      </div>
    </section>

    <div class="priority-grid">
      <section class="list-panel">
        <div class="panel-heading">
          <div><h3>Ödenmemiş Giderler</h3><span>Vadesi en yakın kayıtlar</span></div>
          <button type="button" @click="emit('navigate', 'giderler')">Tümünü Gör <i class="pi pi-arrow-right" /></button>
        </div>
        <div v-if="oncelikliGiderler.length" class="priority-list">
          <button v-for="gider in oncelikliGiderler" :key="gider.id" type="button" class="priority-row" @click="emit('navigate', 'giderler')">
            <span class="row-main">
              <strong>{{ gider.company_name || gider.expense_type || 'Genel Gider' }}</strong>
              <small>{{ gider.expense_type || 'Diğer' }}<template v-if="gider.period"> · {{ gider.period }}</template></small>
            </span>
            <span class="row-meta">
              <strong>{{ tlFormatla(gider.amount) }}</strong>
              <small :class="{ overdue: gider.due_date && gider.due_date < bugun }">{{ vadeEtiketi(gider) }}</small>
            </span>
          </button>
        </div>
        <div v-else class="empty-list"><i class="pi pi-check-circle" /> Ödenmemiş gider bulunmuyor.</div>
      </section>

      <section class="list-panel">
        <div class="panel-heading">
          <div><h3>En Yüksek Borçlar</h3><span>Kalan tutara göre sıralı</span></div>
          <button type="button" @click="emit('navigate', 'borclar')">Tümünü Gör <i class="pi pi-arrow-right" /></button>
        </div>
        <div v-if="yuksekBorclar.length" class="priority-list">
          <button v-for="cari in yuksekBorclar" :key="cari.id" type="button" class="priority-row" @click="emit('navigate', 'borclar')">
            <span class="row-avatar"><i class="pi pi-building" /></span>
            <span class="row-main"><strong>{{ cari.name || 'İsimsiz Cari' }}</strong><small>{{ cari.type || 'Tedarikçi / Taşeron' }}</small></span>
            <span class="row-meta"><strong>{{ tlFormatla(cari.remaining_debt) }}</strong><small>Kalan borç</small></span>
          </button>
        </div>
        <div v-else class="empty-list"><i class="pi pi-check-circle" /> Açık tedarikçi borcu bulunmuyor.</div>
      </section>
    </div>

    <div class="secondary-grid">
      <button type="button" class="secondary-card" @click="emit('navigate', 'alacaklar')">
        <span class="secondary-icon receivable"><i class="pi pi-arrow-down-left" /></span>
        <span><small>Toplam Müşteri Alacağı</small><strong>{{ tlFormatla(summary.totalReceivables) }}</strong><em>{{ summary.openWorkOrderCount }} açık iş emri alacağı</em></span>
        <i class="pi pi-chevron-right arrow" />
      </button>
      <button type="button" class="secondary-card" @click="emit('navigate', 'tum-hareketler')">
        <span class="secondary-icon collection"><i class="pi pi-wallet" /></span>
        <span><small>Bu Ay Tahsil Edilen</small><strong>{{ tlFormatla(summary.currentMonthCollections) }}</strong><em>İş emri ve cari tahsilatları</em></span>
        <i class="pi pi-chevron-right arrow" />
      </button>
      <button type="button" class="secondary-card" @click="emit('navigate', 'karlilik')">
        <span class="secondary-icon profit"><i class="pi pi-chart-line" /></span>
        <span><small>Bu Ay Net Kâr</small><strong :class="{ negative: profitability.netKar < 0 }">{{ tlFormatla(profitability.netKar) }}</strong><em>%{{ Number(profitability.karOrani || 0).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} kâr oranı</em></span>
        <i class="pi pi-chevron-right arrow" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.payment-overview { display: flex; flex-direction: column; gap: 18px; }
.focus-panel, .list-panel { padding: 18px; background: var(--bg-panel, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; }
.section-heading, .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.section-heading { margin-bottom: 14px; }
.section-heading h3, .panel-heading h3 { margin: 0; color: var(--text-title, #f8fafc); }
.section-heading h3 { font-size: 1.05rem; }
.section-heading p, .panel-heading span { margin: 3px 0 0; color: var(--text-muted, #94a3b8); font-size: 0.78rem; }
.payment-load { text-align: right; }
.payment-load span { display: block; color: var(--text-muted, #94a3b8); font-size: 0.72rem; }
.payment-load strong { display: block; margin-top: 2px; color: var(--text-title, #f8fafc); font-size: 1.25rem; }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.stat-card, .priority-row, .secondary-card, .panel-heading button { font: inherit; }
.stat-card { display: flex; align-items: center; gap: 11px; min-width: 0; padding: 13px; text-align: left; color: inherit; background: var(--bg-active-box, #0f172a); border: 1px solid var(--border-color, #334155); border-left-width: 4px; border-radius: 9px; cursor: pointer; transition: 0.15s ease; }
.stat-card:hover, .priority-row:hover, .secondary-card:hover { transform: translateY(-1px); border-color: var(--accent-color, #3b82f6); }
.stat-card.debt { border-left-color: #ef4444; } .stat-card.expense { border-left-color: #f59e0b; } .stat-card.overdue { border-left-color: #dc2626; } .stat-card.upcoming { border-left-color: #38bdf8; }
.stat-icon, .row-avatar, .secondary-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 8px; }
.stat-icon { width: 36px; height: 36px; color: var(--text-title, #f8fafc); background: rgba(148, 163, 184, 0.12); }
.stat-copy { min-width: 0; }
.stat-copy small, .stat-copy strong, .stat-copy em, .secondary-card small, .secondary-card strong, .secondary-card em { display: block; }
.stat-copy small, .secondary-card small { color: var(--text-muted, #94a3b8); font-size: 0.72rem; }
.stat-copy strong { margin: 2px 0; color: var(--text-title, #f8fafc); font-size: 1.05rem; white-space: nowrap; }
.stat-copy em, .secondary-card em { color: var(--text-muted, #94a3b8); font-size: 0.68rem; font-style: normal; }
.priority-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.panel-heading { margin-bottom: 10px; } .panel-heading h3 { font-size: 0.95rem; }
.panel-heading button { padding: 5px 0; color: var(--accent-color, #60a5fa); font-size: 0.75rem; font-weight: 700; background: transparent; border: 0; cursor: pointer; }
.priority-list { display: flex; flex-direction: column; }
.priority-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 4px; text-align: left; color: inherit; background: transparent; border: 0; border-top: 1px solid var(--border-color, #334155); cursor: pointer; transition: 0.15s ease; }
.row-avatar { width: 30px; height: 30px; color: #f87171; background: rgba(239, 68, 68, 0.1); }
.row-main { min-width: 0; flex: 1; }
.row-main strong, .row-main small, .row-meta strong, .row-meta small { display: block; }
.row-main strong { overflow: hidden; color: var(--text-title, #f8fafc); font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }
.row-main small, .row-meta small { margin-top: 2px; color: var(--text-muted, #94a3b8); font-size: 0.68rem; }
.row-meta { flex: 0 0 auto; text-align: right; } .row-meta strong { color: var(--text-title, #f8fafc); font-size: 0.82rem; }
.row-meta small.overdue { color: #f87171; font-weight: 700; }
.empty-list { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 100px; color: #34d399; font-size: 0.82rem; }
.secondary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.secondary-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 13px 14px; text-align: left; color: inherit; background: var(--bg-panel, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 10px; cursor: pointer; transition: 0.15s ease; }
.secondary-icon { width: 34px; height: 34px; } .secondary-icon.receivable { color: #34d399; background: rgba(16, 185, 129, 0.1); } .secondary-icon.collection { color: #38bdf8; background: rgba(56, 189, 248, 0.1); } .secondary-icon.profit { color: #a78bfa; background: rgba(139, 92, 246, 0.1); }
.secondary-card strong { margin: 2px 0; color: var(--text-title, #f8fafc); font-size: 1rem; } .secondary-card strong.negative { color: #f87171; }
.secondary-card .arrow { color: var(--text-muted, #94a3b8); font-size: 0.75rem; }
@media (max-width: 1050px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .secondary-grid { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .priority-grid, .stats-grid { grid-template-columns: 1fr; } .section-heading { align-items: flex-start; } }
</style>
