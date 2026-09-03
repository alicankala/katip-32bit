<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'

// İlk kurulumda bir kez açılan yönlendirme sihirbazı. Ayarların çoğu Destek
// (Admin) modunda düzenlenebildiği için sihirbaz o adımlarda ayar yazmaz,
// nereden yapılacağını anlatır; yalnızca tema herkes tarafından değiştirilebilir.
const props = defineProps({
  visible: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  mevcutTema: { type: String, default: 'dark' }
})

const emit = defineEmits(['update:visible', 'tamamlandi', 'telefon-ac'])

const router = useRouter()
const toast = useToast()

const adim = ref(0)
const secilenTema = ref(props.mevcutTema)
const kaydediliyor = ref(false)

const adimlar = [
  { baslik: 'Hoş Geldiniz', ikon: 'pi pi-sparkles' },
  { baslik: 'Görünüm', ikon: 'pi pi-desktop' },
  { baslik: 'PIN Güvenliği', ikon: 'pi pi-key' },
  { baslik: 'Yedekleme', ikon: 'pi pi-database' },
  { baslik: 'Telefon', ikon: 'pi pi-mobile' },
  { baslik: 'Hazır', ikon: 'pi pi-check-circle' }
]

const sonAdim = computed(() => adim.value === adimlar.length - 1)
const ilerlemeYuzde = computed(() => Math.round(((adim.value + 1) / adimlar.length) * 100))

const temaUygula = (tema) => {
  secilenTema.value = tema
  localStorage.setItem('uygulamaTema', tema)
  document.documentElement.setAttribute('data-theme', tema)
  document.documentElement.style.colorScheme = tema
  if (tema === 'dark') document.documentElement.classList.add('p-dark')
  else document.documentElement.classList.remove('p-dark')
}

const ileri = () => {
  if (!sonAdim.value) adim.value += 1
}

const geri = () => {
  if (adim.value > 0) adim.value -= 1
}

// Sihirbaz tamamlansa da atlansa da bir daha açılmaması için işaretlenir;
// Yardım Merkezi'nden istendiği zaman yeniden açılabilir.
const kapat = async (tamamlandiMi) => {
  kaydediliyor.value = true
  try {
    await window.api?.ayarlariKaydet?.({
      theme: secilenTema.value,
      setup_wizard_done: 'true'
    })
  } catch (e) {
    console.error('Kurulum sihirbazı kaydetme hatası:', e)
  } finally {
    kaydediliyor.value = false
  }

  emit('update:visible', false)
  emit('tamamlandi')

  if (!tamamlandiMi) {
    toast.add({
      severity: 'info',
      summary: 'Sihirbaz kapatıldı',
      detail: 'Kurulum sihirbazını Yardım Merkezi\'nden istediğiniz zaman yeniden açabilirsiniz.',
      life: 4000
    })
  }
}

const ayarlaraGit = async () => {
  await kapat(true)
  router.push('/settings')
}

const yardimaGit = async () => {
  await kapat(true)
  router.push('/help')
}

const telefonuAc = async () => {
  await kapat(true)
  emit('telefon-ac')
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :closable="false"
    :draggable="false"
    header="Kurulum Sihirbazı"
    :style="{ width: '640px', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="wizard">
      <div class="wizard-progress">
        <div class="wizard-progress-bar" :style="{ width: ilerlemeYuzde + '%' }"></div>
      </div>

      <div class="wizard-steps">
        <span
          v-for="(s, i) in adimlar"
          :key="s.baslik"
          class="wizard-step"
          :class="{ active: i === adim, done: i < adim }"
        >
          <i :class="s.ikon"></i>
          <em>{{ s.baslik }}</em>
        </span>
      </div>

      <!-- 1. Hoş Geldiniz -->
      <div v-if="adim === 0" class="wizard-body">
        <h3>Kâtip'e hoş geldiniz</h3>
        <p>
          Bu kısa sihirbaz, programı kullanmaya başlamadan önce yapılması gereken
          birkaç ayarı gösterir. Yaklaşık iki dakika sürer.
        </p>

        <ul class="wizard-list">
          <li><i class="pi pi-bolt"></i> Servise gelen aracı kabul edip iş emri açarsınız.</li>
          <li><i class="pi pi-wrench"></i> Yapılan işi ve takılan parçayı iş emrine işlersiniz.</li>
          <li><i class="pi pi-wallet"></i> Tahsilatı kaydeder, kalan bakiyeyi cari hesapta takip edersiniz.</li>
          <li><i class="pi pi-lock"></i> Gün sonunda kasayı sayıp günü kapatırsınız.</li>
        </ul>
      </div>

      <!-- 2. Görünüm -->
      <div v-else-if="adim === 1" class="wizard-body">
        <h3>Ekran görünümünü seçin</h3>
        <p>Gözünüzü yormayan temayı seçin. Bu ayarı sonradan Ayarlar'dan değiştirebilirsiniz.</p>

        <div class="wizard-theme-row">
          <button
            type="button"
            class="wizard-theme"
            :class="{ selected: secilenTema === 'dark' }"
            @click="temaUygula('dark')"
          >
            <span class="wizard-theme-preview dark"></span>
            <strong>Koyu Tema</strong>
            <em>Loş ortamda ve akşam vardiyasında daha rahat</em>
          </button>

          <button
            type="button"
            class="wizard-theme"
            :class="{ selected: secilenTema === 'light' }"
            @click="temaUygula('light')"
          >
            <span class="wizard-theme-preview light"></span>
            <strong>Açık Tema</strong>
            <em>Aydınlık dükkanda ve gün ışığında daha okunaklı</em>
          </button>
        </div>
      </div>

      <!-- 3. PIN Güvenliği -->
      <div v-else-if="adim === 2" class="wizard-body">
        <h3>PIN kodlarını değiştirin</h3>
        <p>
          Program, hangi işlemi kimin yaptığını PIN girişine göre kaydeder.
          Kurulumla gelen PIN'ler herkes tarafından bilindiği için değiştirilmelidir.
        </p>

        <table class="wizard-table">
          <thead>
            <tr><th>Kullanıcı</th><th>Başlangıç PIN'i</th></tr>
          </thead>
          <tbody>
            <tr><td>Bünyamin Kala</td><td>1111</td></tr>
            <tr><td>Yusuf Kala</td><td>2222</td></tr>
            <tr><td>Ali Kala</td><td>3333</td></tr>
            <tr><td>Destek (Admin)</td><td>4444</td></tr>
          </tbody>
        </table>

        <div class="wizard-note">
          <i class="pi pi-info-circle"></i>
          <span>
            Herkes kendi PIN'ini <strong>Ayarlar → PIN Değiştir</strong> bölümünden,
            kendi oturumunda değiştirir.
          </span>
        </div>

        <Button
          label="Ayarlar'a Git"
          icon="pi pi-cog"
          severity="secondary"
          outlined
          size="small"
          @click="ayarlaraGit"
        />
      </div>

      <!-- 4. Yedekleme -->
      <div v-else-if="adim === 3" class="wizard-body">
        <h3>Yedekleme</h3>
        <p>
          Tüm kayıtlarınız bu bilgisayardaki tek bir veritabanı dosyasında tutulur.
          Yedek almak, bu programda alınabilecek en önemli önlemdir.
        </p>

        <ul class="wizard-list">
          <li><i class="pi pi-check"></i> Program, kapanışta kendiliğinden yedek alacak şekilde gelir.</li>
          <li><i class="pi pi-check"></i> Elle yedek almak için: Destek girişi → Ayarlar → Yedekleme ve Sistem.</li>
          <li><i class="pi pi-exclamation-triangle"></i> Yedekler aynı bilgisayarda durur; ayda bir USB belleğe kopyalayın.</li>
        </ul>

        <div class="wizard-note" :class="{ warn: !isAdmin }">
          <i class="pi pi-shield"></i>
          <span v-if="isAdmin">
            Şu an Destek modundasınız; yedekleme bölümü Ayarlar ekranında görünür.
          </span>
          <span v-else>
            Yedekleme bölümü yalnızca <strong>Destek girişi</strong> (Admin PIN) ile açılan
            oturumda görünür.
          </span>
        </div>
      </div>

      <!-- 5. Telefon -->
      <div v-else-if="adim === 4" class="wizard-body">
        <h3>Telefondan kullanım</h3>
        <p>
          Ustalar telefonundan açık iş emirlerini görebilir, parça/işçilik ekleyebilir
          ve araç fotoğrafı çekip yükleyebilir.
        </p>

        <ul class="wizard-list">
          <li><i class="pi pi-wifi"></i> Telefon ile bilgisayar aynı Wi-Fi ağında olmalıdır.</li>
          <li><i class="pi pi-qrcode"></i> Üst şeritteki telefon simgesinden erişimi açıp QR kodu okutun.</li>
          <li><i class="pi pi-user"></i> Telefonda usta adı seçilip 4 haneli PIN girilir.</li>
        </ul>

        <Button
          label="Telefon Erişimini Aç"
          icon="pi pi-mobile"
          severity="secondary"
          outlined
          size="small"
          @click="telefonuAc"
        />
      </div>

      <!-- 6. Hazır -->
      <div v-else class="wizard-body">
        <h3>Kurulum tamam</h3>
        <p>
          Artık ilk aracı kabul edebilirsiniz. Takıldığınız her yerde sol menüdeki
          <strong>Yardım</strong> bölümünde adım adım anlatım bulunur.
        </p>

        <ul class="wizard-list">
          <li><i class="pi pi-book"></i> Yardım Merkezi: her işin nasıl yapıldığı, arama kutusuyla birlikte.</li>
          <li><i class="pi pi-question-circle"></i> Her ekranın başlığındaki küçük "?" düğmesi, doğrudan o ekranın anlatımını açar.</li>
          <li><i class="pi pi-compass"></i> Bu sihirbaz: Yardım Merkezi'nden istediğiniz zaman yeniden açılabilir.</li>
        </ul>

        <Button
          label="Yardım Merkezi'ni Aç"
          icon="pi pi-book"
          severity="secondary"
          outlined
          size="small"
          @click="yardimaGit"
        />
      </div>
    </div>

    <template #footer>
      <Button
        label="Şimdilik Geç"
        text
        severity="secondary"
        :disabled="kaydediliyor"
        @click="kapat(false)"
      />
      <Button
        v-if="adim > 0"
        label="Geri"
        icon="pi pi-chevron-left"
        severity="secondary"
        outlined
        :disabled="kaydediliyor"
        @click="geri"
      />
      <Button
        v-if="!sonAdim"
        label="Devam"
        icon="pi pi-chevron-right"
        icon-pos="right"
        @click="ileri"
      />
      <Button
        v-else
        label="Bitir"
        icon="pi pi-check"
        severity="success"
        :loading="kaydediliyor"
        @click="kapat(true)"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.wizard {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wizard-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  overflow: hidden;
}

.wizard-progress-bar {
  height: 100%;
  background: var(--accent-color);
  transition: width 0.25s ease;
}

.wizard-steps {
  display: flex;
  justify-content: space-between;
  gap: 4px;
}

.wizard-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  text-align: center;
}

.wizard-step i { font-size: 14px; }
.wizard-step em { font-style: normal; }
.wizard-step.done { color: var(--status-done); }
.wizard-step.active { color: var(--accent-color); font-weight: 600; }

.wizard-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-height: 260px;
  padding-top: 6px;
}

.wizard-body h3 {
  margin: 0;
  color: var(--text-title);
  font-size: var(--fs-lg);
}

.wizard-body p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  line-height: 1.6;
}

.wizard-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 100%;
}

.wizard-list li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  line-height: 1.5;
}

.wizard-list i {
  color: var(--accent-color);
  font-size: 13px;
  margin-top: 3px;
}

.wizard-theme-row {
  display: flex;
  gap: 12px;
  width: 100%;
}

.wizard-theme {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.wizard-theme:hover { border-color: var(--accent-color); }
.wizard-theme.selected {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 1px var(--accent-color) inset;
}

.wizard-theme strong { color: var(--text-title); font-size: var(--fs-sm); }
.wizard-theme em { font-style: normal; font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.45; }

.wizard-theme-preview {
  display: block;
  height: 42px;
  border-radius: 6px;
  margin-bottom: 6px;
  border: 1px solid var(--border-color);
}

.wizard-theme-preview.dark { background: linear-gradient(135deg, #0e1422 0%, #151d2e 60%, #263650 100%); }
.wizard-theme-preview.light { background: linear-gradient(135deg, #f2f5f8 0%, #ffffff 60%, #cbd5e1 100%); }

.wizard-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.wizard-table th,
.wizard-table td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border-color-soft);
}

.wizard-table th { color: var(--text-muted); font-weight: 600; font-size: var(--fs-xs); }
.wizard-table td { color: var(--text-secondary); }
.wizard-table td:last-child { font-family: monospace; letter-spacing: 0.12em; color: var(--text-title); }

.wizard-note {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 11px 13px;
  border-radius: 8px;
  background: var(--status-done-bg);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  line-height: 1.5;
}

.wizard-note i { color: var(--status-done); margin-top: 2px; }

.wizard-note.warn {
  background: var(--status-pending-bg);
  border-color: rgba(245, 158, 11, 0.28);
}

.wizard-note.warn i { color: var(--status-pending); }
</style>
