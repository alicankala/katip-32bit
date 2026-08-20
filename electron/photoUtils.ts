// Fotoğraf küçültme/sıkıştırma — masaüstü (dosya seçme) ve mobil (telefondan
// yükleme) yollarının ortak noktası.
//
// Masaüstü yolu bu küçültmeyi başından beri yapıyordu; mobil yolu yapmıyor,
// telefon kamerasından gelen 3-8 MB'lık kareyi olduğu gibi diske yazıyordu.
// Fotoğraflar arayüze tek seferde okunup gönderildiği için birkaç mobil
// fotoğrafı olan bir iş emri onlarca MB'lık bir yük çıkarıyordu. İki yol da
// artık aynı sınırları kullanıyor.

import { nativeImage, type NativeImage } from 'electron'

// Uzun kenar üst sınırı ve JPEG kalitesi. Masaüstü yolunda kullanılan
// değerlerle birebir aynı; davranış değişmesin diye bilerek korundu.
export const FOTOGRAF_MAKS_KENAR = 1280
export const FOTOGRAF_JPEG_KALITE = 75

// Görüntüyü en-boy oranını koruyarak FOTOGRAF_MAKS_KENAR'a indirir ve JPEG
// olarak kodlar. Zaten küçükse yeniden boyutlandırma yapılmaz, yalnızca JPEG'e
// kodlanır.
//
// Çözülemeyen/boş bir görüntüde null döner: çağıran taraf o durumda ham veriyi
// olduğu gibi yazmaya devam eder, böylece sıkıştırma başarısız olsa bile
// fotoğraf kaybolmaz.
export function fotografiKucult(image: NativeImage): Buffer | null {
  if (!image || image.isEmpty()) return null

  const size = image.getSize()
  if (!size || !size.width || !size.height) return null

  let hedef = image
  if (size.width > FOTOGRAF_MAKS_KENAR || size.height > FOTOGRAF_MAKS_KENAR) {
    hedef = size.width > size.height
      ? image.resize({ width: FOTOGRAF_MAKS_KENAR, quality: 'better' })
      : image.resize({ height: FOTOGRAF_MAKS_KENAR, quality: 'better' })
  }

  const jpeg = hedef.toJPEG(FOTOGRAF_JPEG_KALITE)
  // toJPEG kodlayamazsa boş buffer döner; boş dosya yazmaktansa ham veriye düş.
  if (!jpeg || jpeg.length === 0) return null

  return jpeg
}

// Dosya yolundan okuyup küçültür (masaüstü: dosya seçme diyaloğu).
export function fotografiYoldanKucult(filePath: string): Buffer | null {
  return fotografiKucult(nativeImage.createFromPath(filePath))
}

// Ham bayttan küçültür (mobil: base64 gövde).
export function fotografiBufferdanKucult(buffer: Buffer): Buffer | null {
  return fotografiKucult(nativeImage.createFromBuffer(buffer))
}
