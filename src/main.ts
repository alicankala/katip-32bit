import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Aura from '@primevue/themes/aura'
import App from './App.vue'
import router from './router'

import 'primeicons/primeicons.css'
import './assets/app.css'

// Sayısal fiyat/tutar alanı 0 ile açıldığında kullanıcı sıfırı elle silmeden
// doğrudan yazabilsin. Adet/miktar gibi 1 değerleri ve gerçek değerler korunur.
document.addEventListener('focusin', (event) => {
  const input = event.target
  if (input instanceof HTMLInputElement && input.type === 'number' && Number(input.value) === 0) {
    queueMicrotask(() => input.select())
  }
})

// Pencere içindeki normal giriş alanlarında Enter, sağ alttaki ana işlemi çalıştırır.
// Açılır liste/otomatik tamamlama alanları kendi Enter davranışını kullanmaya devam eder.
document.addEventListener('keydown', (event) => {
  const input = event.target
  if (
    event.key !== 'Enter' || event.repeat || event.isComposing ||
    event.ctrlKey || event.altKey || event.shiftKey || event.metaKey ||
    !(input instanceof HTMLInputElement) ||
    input.dataset.enterHandled === 'true' ||
    ['button', 'checkbox', 'file', 'radio', 'reset', 'submit'].includes(input.type) ||
    input.closest('.p-autocomplete, .p-select, .p-dropdown')
  ) return

  const dialog = input.closest('.p-dialog')
  const footerButtons = dialog?.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button')
  const actionButton = footerButtons?.item((footerButtons?.length || 0) - 1)
  if (!actionButton || actionButton.disabled) return

  event.preventDefault()
  actionButton.click()
})

const app = createApp(App)

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '[data-theme="dark"]'
    }
  }
})

app.use(ToastService)
app.use(ConfirmationService)
app.use(router)

app.mount('#app')
