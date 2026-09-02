// Üst bardaki genel yenileme, açık sayfanın veri yükleme işlemini bekleyebilsin.
// Normal app-data-refreshed yayınlarında da aynı işleyici sorunsuz çalışır.
export function genelVeriYenilemeIsleyicisi(yenile) {
  return (event) => {
    const islem = Promise.resolve().then(() => yenile())
    event?.detail?.waitUntil?.(islem)
    return islem
  }
}
