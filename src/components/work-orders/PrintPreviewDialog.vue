<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useFormatters } from '../../composables/useFormatters'
import { firmaBilgileri, firmaIletisimSatirlari } from '../../data/firmaBilgileri.js'

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  seciliIsEmri: {
    type: Object,
    default: () => null
  },
  kalemler: {
    type: Array,
    default: () => []
  },
  bosKalemModu: {
    type: Boolean,
    default: false
  },
  showPaymentSummary: {
    type: Boolean,
    default: true
  },
  odemeOzeti: {
    type: Object,
    default: () => ({
      toplam_tahsilat: 0,
      kalan_borc: 0,
      odeme_durumu: 'Bilinmiyor'
    })
  }
})

const emit = defineEmits(['update:visible', 'error', 'warning'])

const show = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const { tlFormatla, tarihSaatFormatla: tarihFormatla } = useFormatters()

// Boş ve dolu fiş aynı iki sütunlu atölye formunu kullanır. Her sayfa 40 kalem
// taşır; daha uzun listeler aynı form düzeniyle yeni sayfaya devam eder.
const atolyeSutunuBasinaSatir = 22
const sayfaBasinaKalem = atolyeSutunuBasinaSatir * 2

const kalemAciklamasi = (kalem) => {
  if (!kalem) return ''
  if (kalem.type === 'Parça') {
    return `${kalem.part_code || ''} ${kalem.part_name || kalem.description || ''}`.trim()
  }
  return kalem.description || '-'
}

const kalemSayfalariniOlustur = (kalemler) => {
  const sayfaSayisi = Math.max(1, Math.ceil(kalemler.length / sayfaBasinaKalem))

  return Array.from({ length: sayfaSayisi }, (_, sayfaIndex) => (
    Array.from({ length: 2 }, (_, sutunIndex) => (
      Array.from({ length: atolyeSutunuBasinaSatir }, (_, satirIndex) => {
        const genelIndex = sayfaIndex * sayfaBasinaKalem + sutunIndex * atolyeSutunuBasinaSatir + satirIndex
        return {
          sira: genelIndex + 1,
          kalem: kalemler[genelIndex] || null
        }
      })
    ))
  ))
}

const onizlemeKalemSayfalari = computed(() => (
  kalemSayfalariniOlustur(props.bosKalemModu ? [] : props.kalemler)
))

const guvenliMetin = (deger) => {
  return String(deger ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const ayariBooleanYap = (val, varsayilan = true) => {
  if (val === undefined || val === null) return varsayilan
  if (typeof val === 'boolean') return val
  const s = String(val).trim().toLowerCase()
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
  return Boolean(val)
}

const servisFisiYazdirGercek = async () => {
  let showPayment = true
  try {
    const sRes = await window.api?.ayarlariGetir?.()
    if (sRes?.settings && sRes.settings.show_payment_summary_on_receipt !== undefined) {
      showPayment = ayariBooleanYap(sRes.settings.show_payment_summary_on_receipt, true)
    }
  } catch (e) {
    console.error('Ayar getirilemedi', e)
  }

  if (!props.seciliIsEmri) {
    emit('warning', 'Yazdırılacak iş emri seçilemedi.')
    return
  }

  const isEmri = props.seciliIsEmri

  const firma = firmaBilgileri
  const yazdirilacakKalemler = props.bosKalemModu ? [] : props.kalemler

  const kalemSayfalariHtml = kalemSayfalariniOlustur(yazdirilacakKalemler).map((sayfa, sayfaIndex) => `
    <div class="items-page ${sayfaIndex > 0 ? 'continuation-page' : ''}">
      ${sayfaIndex > 0 ? `
        <div class="continuation-context">
          Servis Fişi Devamı · İş Emri #${guvenliMetin(isEmri.id)} ·
          ${guvenliMetin(isEmri.plate || '-')} · ${guvenliMetin(isEmri.customer_name || '-')}
        </div>
      ` : ''}
      <div class="manual-items-grid">
        ${sayfa.map((satirlar) => `
          <table class="manual-items-table">
            <thead>
              <tr>
                <th style="width: 24px;" class="center">#</th>
                <th>Parça / İşçilik Açıklaması</th>
                <th style="width: 34px;" class="center">Adet</th>
                <th style="width: 62px;" class="center">Tutar</th>
              </tr>
            </thead>
            <tbody>
              ${satirlar.map(({ sira, kalem }) => `
                <tr class="blank-item-row">
                  <td class="center">${sira}</td>
                  <td class="item-description">
                    ${kalem ? `
                      <span class="item-kind">${guvenliMetin(kalem.type === 'Parça' ? 'P' : 'İ')}</span>
                      ${guvenliMetin(kalemAciklamasi(kalem))}
                    ` : ''}
                  </td>
                  <td class="center item-quantity">
                    ${kalem ? guvenliMetin(kalem.quantity || 0) : ''}
                  </td>
                  <td class="center item-amount">
                    ${kalem ? `
                      <strong>${guvenliMetin(tlFormatla(kalem.total_price))}</strong>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `).join('')}
      </div>
    </div>
  `).join('')

  const toplamTutar = yazdirilacakKalemler.reduce((toplam, kalem) => {
    return toplam + Number(kalem.total_price || 0)
  }, 0)

  const yazdirmaPenceresi = window.open('', '_blank')

  if (!yazdirmaPenceresi) {
    emit('error', 'Yazdırma penceresi açılamadı.')
    return
  }

  yazdirmaPenceresi.document.write(`
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charset="UTF-8" />
        <title>Servis Fişi - İş Emri ${guvenliMetin(isEmri.id)}</title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 18px;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            background: #ffffff;
            font-size: 11.5px;
            line-height: 1.3;
          }

          .page {
            max-width: 794px;
            margin: 0 auto;
          }

          .top-header {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 230px;
            gap: 0;
            align-items: center;
            border: 1.5px solid #111827;
            border-radius: 4px;
            margin-bottom: 6px;
            overflow: hidden;
          }

          .company-box {
            min-width: 0;
            padding: 7px 9px;
          }

          .company-name {
            font-size: 24px;
            font-weight: 900;
            letter-spacing: -0.3px;
            margin: 0;
            color: #111827;
            line-height: 1.05;
          }

          .company-subtitle {
            margin-top: 2px;
            color: #374151;
            font-size: 12px;
            font-weight: 700;
          }

          .company-desc {
            display: inline;
            margin-right: 10px;
            color: #6b7280;
            font-size: 10px;
          }

          .company-contact-line {
            margin-top: 3px;
            line-height: 1.2;
          }

          .document-box {
            align-self: stretch;
            border-left: 1px solid #111827;
            padding: 6px 8px;
            text-align: right;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          .document-title {
            font-size: 17px;
            font-weight: 900;
            margin-bottom: 3px;
            color: #111827;
          }

          .document-no {
            font-size: 12px;
            font-weight: 800;
            margin-bottom: 2px;
          }

          .muted {
            color: #6b7280;
          }

          .section {
            border: 1px solid #d1d5db;
            border-radius: 4px;
            margin-bottom: 6px;
            overflow: hidden;
          }

          .section-title {
            background: #f3f4f6;
            border-bottom: 1px solid #d1d5db;
            padding: 4px 6px;
            font-weight: 900;
            font-size: 11px;
            color: #111827;
          }

          .section-body {
            padding: 5px 6px;
          }

          .info-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 4px 12px;
          }

          .header-info-grid {
            grid-column: 1 / -1;
            border-top: 1px solid #111827;
            padding: 5px 8px;
            background: #f9fafb;
          }

          .info-row {
            min-width: 0;
          }

          .info-row.wide {
            grid-column: span 2;
          }

          .label {
            color: #4b5563;
            font-weight: 700;
            font-size: 8.8px;
            text-transform: uppercase;
            letter-spacing: 0.25px;
          }

          .value {
            color: #111827;
            font-weight: 600;
            font-size: 11px;
            margin-top: 1px;
            overflow-wrap: anywhere;
          }

          .description-box {
            min-height: 11mm;
            line-height: 1.3;
            color: #111827;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }

          .complaint-section {
            display: grid;
            grid-template-columns: 126px minmax(0, 1fr);
          }

          .complaint-section .section-title {
            border-right: 1px solid #d1d5db;
            border-bottom: 0;
            display: flex;
            align-items: center;
          }

          .complaint-section .section-body {
            padding: 4px 6px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          th {
            background: #f3f4f6;
            color: #111827;
            font-weight: 900;
            border: 1px solid #d1d5db;
            padding: 4px 5px;
            text-align: left;
          }

          td {
            border: 1px solid #d1d5db;
            padding: 4px 5px;
            vertical-align: top;
            overflow-wrap: anywhere;
          }

          .center {
            text-align: center;
          }

          .right {
            text-align: right;
          }

          .strong {
            font-weight: 900;
          }

          .total-area {
            display: flex;
            justify-content: flex-end;
            margin-top: 6px;
          }

          .total-box {
            min-width: 235px;
            border: 1.5px solid #111827;
            border-radius: 4px;
            overflow: hidden;
          }

          .total-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 5px 7px;
            font-size: 11px;
            font-weight: 900;
            background: #f9fafb;
          }

          .total-row + .total-row {
            border-top: 1px solid #e5e7eb;
          }

          .total-row.payment-row {
            font-size: 9px;
            color: #4b5563;
          }

          .warning-note {
            margin-top: 6px;
            border: 1px solid #f59e0b;
            background: #fffbeb;
            color: #92400e;
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 8.5px;
            font-weight: 800;
            line-height: 1.25;
          }

          .items-section {
            overflow: visible;
          }

          .items-section .section-body {
            padding: 0;
          }

          .items-section table {
            table-layout: fixed;
          }

          .manual-items-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 5px;
            padding: 0;
          }

          .manual-items-table th {
            font-size: 9.5px;
            padding: 4px;
          }

          .manual-items-table td {
            padding: 3px 4px;
            font-size: 9.5px;
          }

          .item-kind {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 15px;
            height: 15px;
            margin-right: 2px;
            border: 1px solid #9ca3af;
            border-radius: 2px;
            font-size: 8px;
            font-weight: 900;
          }

          .item-amount strong {
            display: block;
          }

          .item-amount strong {
            font-size: 8.5px;
          }

          .item-description,
          .item-quantity,
          .item-amount {
            vertical-align: middle;
          }

          .manual-total-space {
            display: inline-block;
            min-width: 88px;
            min-height: 14px;
          }

          .blank-item-row td {
            height: 7.8mm;
          }

          .continuation-page {
            break-before: page;
            page-break-before: always;
          }

          .continuation-context {
            border: 1px solid #111827;
            border-bottom: 0;
            padding: 4px 6px;
            font-size: 9px;
            font-weight: 800;
          }

          .closing-block {
            break-inside: avoid;
            page-break-inside: avoid;
            padding: 0 6px 2px;
          }

          .print-actions {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 16px;
          }

          .print-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border: none;
            border-radius: 999px;
            padding: 10px 18px;
            cursor: pointer;
            font-weight: 900;
            font-size: 13px;
            color: #ffffff;
            background: linear-gradient(135deg, #2563eb, #1d4ed8);
            box-shadow: 0 8px 18px rgba(37, 99, 235, 0.28);
          }

          .print-btn:hover {
            background: linear-gradient(135deg, #1d4ed8, #1e40af);
          }

          .print-icon {
            font-size: 15px;
            line-height: 1;
          }

          @media print {
            @page {
              size: A4 portrait;
              margin: 8mm 9mm 9mm;
            }

            body {
              padding: 0;
              font-size: 11px;
            }

            .page {
              max-width: none;
              margin: 0;
            }

            .print-actions {
              display: none;
            }

            .top-header,
            .complaint-section,
            .closing-block {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .items-section {
              break-inside: auto;
              page-break-inside: auto;
            }

            thead {
              display: table-header-group;
            }

            tr,
            td,
            th {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }
        </style>
      </head>

      <body>
        <div class="page">
          <div class="print-actions">
            <button class="print-btn" onclick="window.print()">
              <span class="print-icon">🖨</span>
              <span>Yazdır</span>
            </button>
          </div>

          <div class="top-header">
            <div class="company-box">
              <h1 class="company-name">${guvenliMetin(firma.unvan)}</h1>
              <div class="company-subtitle">${guvenliMetin(firma.altBaslik)}</div>
              <div class="company-contact-line">
                ${firmaIletisimSatirlari().map((satir) => `<span class="company-desc">${guvenliMetin(satir)}</span>`).join('')}
              </div>
            </div>

            <div class="document-box">
              <div class="document-title">SERVİS FİŞİ</div>
              <div class="document-no">İş Emri No: #${guvenliMetin(isEmri.id)}</div>
              <div class="muted">Fiş Tarihi: ${guvenliMetin(tarihFormatla(isEmri.created_at))}</div>
              <div class="muted">Durum: ${guvenliMetin(isEmri.status || '-')}</div>
            </div>

            <div class="header-info-grid info-grid">
              <div class="info-row wide">
                <div class="label">Müşteri</div>
                <div class="value">${guvenliMetin(isEmri.customer_name || '-')}</div>
              </div>
              <div class="info-row">
                <div class="label">Telefon</div>
                <div class="value">${guvenliMetin(isEmri.customer_phone || '-')}</div>
              </div>
              <div class="info-row">
                <div class="label">Plaka</div>
                <div class="value">${guvenliMetin(isEmri.plate || '-')}</div>
              </div>
              <div class="info-row wide">
                <div class="label">Marka / Model</div>
                <div class="value">${guvenliMetin(`${isEmri.brand || '-'} / ${isEmri.model || '-'}`)}</div>
              </div>
              <div class="info-row">
                <div class="label">Şase</div>
                <div class="value">${guvenliMetin(isEmri.chassis || '-')}</div>
              </div>
              <div class="info-row">
                <div class="label">Kilometre</div>
                <div class="value">${guvenliMetin(isEmri.mileage ? Number(isEmri.mileage).toLocaleString('tr-TR') + ' km' : '-')}</div>
              </div>
              <div class="info-row">
                <div class="label">Açılış Tarihi</div>
                <div class="value">${guvenliMetin(tarihFormatla(isEmri.created_at))}</div>
              </div>
              <div class="info-row">
                <div class="label">Kapanış</div>
                <div class="value">${guvenliMetin(tarihFormatla(isEmri.closed_at))}</div>
              </div>
            </div>
          </div>

          <div class="section complaint-section">
            <div class="section-title">Müşteri Talebi / Şikâyeti</div>

            <div class="section-body">
              <div class="description-box">${guvenliMetin(isEmri.description || '')}</div>
            </div>
          </div>

          <div class="section items-section">
            <div class="section-title">Parça ve İşçilik Kalemleri</div>

            <div class="section-body">
              ${kalemSayfalariHtml}

              <div class="closing-block">
${props.bosKalemModu ? `
                <div class="total-area">
                  <div class="total-box">
                    <div class="total-row">
                      <span>Genel Toplam</span>
                      <span class="manual-total-space">&nbsp;</span>
                    </div>
                  </div>
                </div>
` : yazdirilacakKalemler.length > 0 ? `
                <div class="total-area">
                  <div class="total-box">
                    <div class="total-row">
                      <span>Genel Toplam</span>
                      <span>${guvenliMetin(tlFormatla(toplamTutar || isEmri.total_price))}</span>
                    </div>
${showPayment ? `
                    <div class="total-row payment-row">
                      <span>Tahsil Edilen</span>
                      <span>${guvenliMetin(tlFormatla(props.odemeOzeti.toplam_tahsilat))}</span>
                    </div>
                    <div class="total-row payment-row">
                      <span>Kalan Borç</span>
                      <span>${guvenliMetin(tlFormatla(props.odemeOzeti.kalan_borc))}</span>
                    </div>
                    <div class="total-row payment-row">
                      <span>Ödeme Durumu</span>
                      <span>${guvenliMetin(props.odemeOzeti.odeme_durumu)}</span>
                    </div>
` : ''}
                  </div>
                </div>
` : ''}

                <div class="warning-note">
                  Bu belge fatura değildir; e-fatura, e-arşiv fatura veya resmi mali belge yerine geçmez.
                  Yalnızca servis takip ve bilgilendirme fişidir.
                </div>

              </div>
            </div>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
          window.onafterprint = function() {
            window.close();
          };
        <\/script>
      </body>
    </html>
  `)

  yazdirmaPenceresi.document.close()
}
</script>

<template>
  <Dialog
    v-model:visible="show"
    :header="bosKalemModu ? 'Boş Servis Fişi Önizleme' : 'Servis Fişi Önizleme'"
    :style="{ width: '850px' }"
    modal
  >
    <div class="print-preview-content">
      <div class="preview-sheet">
        <div class="top-header">
          <div class="company-box">
            <h1 class="company-name">{{ firmaBilgileri.unvan }}</h1>
            <div class="company-subtitle">{{ firmaBilgileri.altBaslik }}</div>
            <div class="company-contact-line">
              <span v-for="satir in firmaIletisimSatirlari()" :key="satir" class="company-desc">{{ satir }}</span>
            </div>
          </div>

          <div class="document-box">
            <div class="document-title">SERVİS FİŞİ</div>
            <div class="document-no">İş Emri No: #{{ seciliIsEmri?.id }}</div>
            <div class="muted">Fiş Tarihi: {{ tarihFormatla(seciliIsEmri?.created_at) }}</div>
            <div class="muted">Durum: {{ seciliIsEmri?.status }}</div>
          </div>

          <div class="header-info-grid info-grid">
            <div class="info-row wide">
              <div class="label">Müşteri</div>
              <div class="value">{{ seciliIsEmri?.customer_name || '-' }}</div>
            </div>
            <div class="info-row">
              <div class="label">Telefon</div>
              <div class="value">{{ seciliIsEmri?.customer_phone || '-' }}</div>
            </div>
            <div class="info-row">
              <div class="label">Plaka</div>
              <div class="value">{{ seciliIsEmri?.plate || '-' }}</div>
            </div>
            <div class="info-row wide">
              <div class="label">Marka / Model</div>
              <div class="value">{{ seciliIsEmri?.brand || '-' }} / {{ seciliIsEmri?.model || '-' }}</div>
            </div>
            <div class="info-row">
              <div class="label">Şase</div>
              <div class="value">{{ seciliIsEmri?.chassis || '-' }}</div>
            </div>
            <div class="info-row">
              <div class="label">Kilometre</div>
              <div class="value">{{ seciliIsEmri?.mileage ? Number(seciliIsEmri.mileage).toLocaleString('tr-TR') + ' km' : '-' }}</div>
            </div>
            <div class="info-row">
              <div class="label">Açılış Tarihi</div>
              <div class="value">{{ tarihFormatla(seciliIsEmri?.created_at) }}</div>
            </div>
            <div class="info-row">
              <div class="label">Kapanış</div>
              <div class="value">{{ tarihFormatla(seciliIsEmri?.closed_at) }}</div>
            </div>
          </div>
        </div>

        <div class="section complaint-section">
          <div class="section-title">Müşteri Talebi / Şikâyeti</div>
          <div class="section-body">
            <div class="description-box">{{ seciliIsEmri?.description || '' }}</div>
          </div>
        </div>

        <div class="section items-section">
          <div class="section-title">Parça ve İşçilik Kalemleri</div>
          <div class="section-body">
            <div
              v-for="(sayfa, sayfaIndex) in onizlemeKalemSayfalari"
              :key="sayfaIndex"
              class="items-page"
              :class="{ 'continuation-page': sayfaIndex > 0 }"
            >
              <div v-if="sayfaIndex > 0" class="continuation-context">
                Servis Fişi Devamı · İş Emri #{{ seciliIsEmri?.id }} ·
                {{ seciliIsEmri?.plate || '-' }} · {{ seciliIsEmri?.customer_name || '-' }}
              </div>

              <div class="manual-items-grid">
                <table v-for="(satirlar, sutunIndex) in sayfa" :key="sutunIndex" class="manual-items-table">
                  <thead>
                    <tr>
                      <th style="width: 24px;" class="center">#</th>
                      <th>Parça / İşçilik Açıklaması</th>
                      <th style="width: 34px;" class="center">Adet</th>
                      <th style="width: 62px;" class="center">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="satir in satirlar" :key="satir.sira" class="blank-item-row">
                      <td class="center">{{ satir.sira }}</td>
                      <td class="item-description">
                        <template v-if="satir.kalem">
                          <span class="item-kind">{{ satir.kalem.type === 'Parça' ? 'P' : 'İ' }}</span>
                          {{ kalemAciklamasi(satir.kalem) }}
                        </template>
                      </td>
                      <td class="center item-quantity">
                        <template v-if="satir.kalem">{{ satir.kalem.quantity || 0 }}</template>
                      </td>
                      <td class="center item-amount">
                        <template v-if="satir.kalem">
                          <strong>{{ tlFormatla(satir.kalem.total_price) }}</strong>
                        </template>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="closing-block">
              <div v-if="bosKalemModu || kalemler.length > 0" class="total-area">
                <div class="total-box">
                  <div class="total-row">
                    <span>Genel Toplam</span>
                    <span v-if="!bosKalemModu">{{ tlFormatla(kalemler.reduce((toplam, kalem) => toplam + Number(kalem.total_price || 0), 0) || seciliIsEmri?.total_price) }}</span>
                    <span v-else class="manual-total-space" aria-hidden="true"></span>
                  </div>
                  <div v-if="showPaymentSummary && !bosKalemModu" class="total-row payment-row">
                    <span>Tahsil Edilen</span>
                    <span>{{ tlFormatla(odemeOzeti.toplam_tahsilat) }}</span>
                  </div>
                  <div v-if="showPaymentSummary && !bosKalemModu" class="total-row payment-row">
                    <span>Kalan Borç</span>
                    <span>{{ tlFormatla(odemeOzeti.kalan_borc) }}</span>
                  </div>
                  <div v-if="showPaymentSummary && !bosKalemModu" class="total-row payment-row">
                    <span>Ödeme Durumu</span>
                    <span>{{ odemeOzeti.odeme_durumu }}</span>
                  </div>
                </div>
              </div>

              <div class="warning-note">
                Bu belge fatura değildir; e-fatura, e-arşiv fatura veya resmi mali belge yerine geçmez.
                Yalnızca servis takip ve bilgilendirme fişidir.
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        label="Yazdır"
        icon="pi pi-print"
        style="background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: bold; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);"
        @click="servisFisiYazdirGercek"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.print-preview-content {
  background-color: #1e293b;
  padding: 20px;
  border-radius: 6px;
  max-height: 70vh;
  overflow-y: auto;
}

:global(html[data-theme="light"]) .print-preview-content {
  background-color: #f1f5f9;
}

.preview-sheet {
  background-color: #ffffff;
  color: #111827;
  padding: 26px 30px 30px;
  border-radius: 4px;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11.5px;
  line-height: 1.3;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
  max-width: 800px;
  margin: 0 auto;
}

.preview-sheet .top-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 230px;
  gap: 0;
  align-items: center;
  border: 1.5px solid #111827;
  border-radius: 4px;
  margin-bottom: 6px;
  overflow: hidden;
}

.preview-sheet .company-box {
  min-width: 0;
  padding: 7px 9px;
}

.preview-sheet .company-name {
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.3px;
  margin: 0;
  color: #111827;
  line-height: 1.05;
}

.preview-sheet .company-subtitle {
  margin-top: 2px;
  color: #374151;
  font-size: 12px;
  font-weight: 700;
}

.preview-sheet .company-desc {
  margin-right: 10px;
  color: #6b7280;
  font-size: 10px;
}

.preview-sheet .company-contact-line {
  margin-top: 3px;
  line-height: 1.2;
}

.preview-sheet .document-box {
  align-self: stretch;
  border-left: 1px solid #111827;
  padding: 6px 8px;
  text-align: right;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.preview-sheet .document-title {
  font-size: 17px;
  font-weight: 900;
  margin-bottom: 3px;
  color: #111827;
}

.preview-sheet .document-no {
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 2px;
}

.preview-sheet .muted {
  color: #6b7280;
}

.preview-sheet .section {
  border: 1px solid #d1d5db;
  border-radius: 4px;
  margin-bottom: 6px;
  overflow: hidden;
  background: #ffffff;
}

.preview-sheet .section-title {
  background: #f3f4f6;
  border-bottom: 1px solid #d1d5db;
  padding: 4px 6px;
  font-weight: 900;
  font-size: 11px;
  color: #111827;
}

.preview-sheet .section-body {
  padding: 5px 6px;
}

.preview-sheet .info-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px 12px;
}

.preview-sheet .header-info-grid {
  grid-column: 1 / -1;
  border-top: 1px solid #111827;
  padding: 5px 8px;
  background: #f9fafb;
}

.preview-sheet .info-row {
  min-width: 0;
}

.preview-sheet .info-row.wide {
  grid-column: span 2;
}

.preview-sheet .label {
  color: #4b5563;
  font-weight: 700;
  font-size: 8.8px;
  text-transform: uppercase;
  letter-spacing: 0.25px;
}

.preview-sheet .value {
  color: #111827;
  font-weight: 600;
  font-size: 11px;
  margin-top: 1px;
  overflow-wrap: anywhere;
}

.preview-sheet .description-box {
  min-height: 11mm;
  line-height: 1.3;
  color: #111827;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-sheet .complaint-section {
  display: grid;
  grid-template-columns: 126px minmax(0, 1fr);
}

.preview-sheet .complaint-section .section-title {
  border-right: 1px solid #d1d5db;
  border-bottom: 0;
  display: flex;
  align-items: center;
}

.preview-sheet .complaint-section .section-body {
  padding: 4px 6px;
}

.preview-sheet table {
  width: 100%;
  border-collapse: collapse;
}

.preview-sheet th {
  background: #f3f4f6;
  color: #111827;
  font-weight: 900;
  border: 1px solid #d1d5db;
  padding: 4px 5px;
  text-align: left;
}

.preview-sheet td {
  border: 1px solid #d1d5db;
  padding: 4px 5px;
  vertical-align: top;
  color: #111827;
  overflow-wrap: anywhere;
}

.preview-sheet .center {
  text-align: center;
}

.preview-sheet .right {
  text-align: right;
}

.preview-sheet .strong {
  font-weight: 900;
}

.preview-sheet .total-area {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}

.preview-sheet .total-box {
  min-width: 235px;
  border: 1.5px solid #111827;
  border-radius: 4px;
  overflow: hidden;
}

.preview-sheet .total-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 7px;
  font-size: 11px;
  font-weight: 900;
  background: #f9fafb;
  color: #111827;
}

.preview-sheet .total-row + .total-row {
  border-top: 1px solid #e5e7eb;
}

.preview-sheet .total-row.payment-row {
  font-size: 9px;
  color: #4b5563;
}

.preview-sheet .warning-note {
  margin-top: 6px;
  border: 1px solid #f59e0b;
  background: #fffbeb;
  color: #92400e;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 8.5px;
  font-weight: 800;
  line-height: 1.25;
}

.preview-sheet .items-section {
  overflow: visible;
}

.preview-sheet .items-section .section-body {
  padding: 0;
}

.preview-sheet .items-section table {
  table-layout: fixed;
}

.preview-sheet .manual-items-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding: 0;
}

.preview-sheet .manual-items-table th {
  font-size: 9.5px;
  padding: 4px;
}

.preview-sheet .manual-items-table td {
  padding: 3px 4px;
  font-size: 9.5px;
}

.preview-sheet .item-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  margin-right: 2px;
  border: 1px solid #9ca3af;
  border-radius: 2px;
  font-size: 8px;
  font-weight: 900;
}

.preview-sheet .item-amount strong {
  display: block;
}

.preview-sheet .item-amount strong {
  font-size: 8.5px;
}

.preview-sheet .item-description,
.preview-sheet .item-quantity,
.preview-sheet .item-amount {
  vertical-align: middle;
}

.preview-sheet .manual-total-space {
  display: inline-block;
  min-width: 88px;
  min-height: 14px;
}

.preview-sheet .blank-item-row td {
  height: 7.8mm;
}

.preview-sheet .continuation-page {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 2px dashed #9ca3af;
}

.preview-sheet .continuation-context {
  border: 1px solid #111827;
  border-bottom: 0;
  padding: 4px 6px;
  font-size: 9px;
  font-weight: 800;
}

.preview-sheet .closing-block {
  padding: 0 6px 2px;
}
</style>
