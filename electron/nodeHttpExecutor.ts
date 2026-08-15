// Güncelleme isteklerini Node üzerinden yapan HTTP istemcisi.
//
// NEDEN VAR:
// electron-updater varsayılan olarak Electron'un (Chromium) `net` modülünü kullanır.
// Chromium, Windows'ta sunucu sertifikalarını işletim sisteminin kök sertifika
// deposundan doğrular. Windows 7'nin kök sertifika deposu Microsoft tarafından
// 2020'den beri güncellenmiyor; GitHub'ın sertifikaları ise güncel köklere
// (ISRG Root X1, Sectigo/USERTrust) dayanıyor. Sonuç: Windows 7'de güncelleme
// denetimi ERR_CERT_AUTHORITY_INVALID ile reddediliyordu.
//
// Node kendi gömülü CA listesini taşır ve işletim sisteminin deposuna bakmaz.
// Bu yüzden ağ katmanı Node'a alınınca güncelleme Windows 7'de de çalışıyor.
//
// NOT: builder-util-runtime'daki temel HttpExecutor zaten Node tarzı istekler için
// yazılmış (yönlendirmeleri `location` başlığından kendisi yönetir, bkz.
// addRedirectHandlers "not required for NodeJS"). Bu yüzden yalnızca istek
// oluşturma ve indirme metotlarını sağlamak yeterli.

import http from 'node:http'
import https from 'node:https'
import type { ClientRequest } from 'node:http'
import {
  HttpExecutor,
  configureRequestUrl,
  configureRequestOptions,
  type DownloadOptions
} from 'builder-util-runtime'

export class NodeHttpExecutor extends HttpExecutor<ClientRequest> {
  createRequest(options: any, callback: (response: any) => void): ClientRequest {
    // Bazı sunucular (ör. imzalı S3 adresleri) Host başlığını ayrıca gönderiyor;
    // Node'da bu geçersiz istek hatasına yol açtığı için options.host'a taşınıyor.
    if (options.headers && options.headers.Host) {
      options.host = options.headers.Host
      delete options.headers.Host
    }

    const modul = options.protocol === 'http:' ? http : https
    return modul.request(options, callback)
  }

  async download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
    return await options.cancellationToken.createPromise<string>((resolve, reject, onCancel) => {
      const requestOptions: any = { headers: options.headers || undefined }
      configureRequestUrl(url, requestOptions)
      configureRequestOptions(requestOptions)

      this.doDownload(
        requestOptions,
        {
          destination,
          options,
          onCancel,
          callback: (error: Error | null) => {
            if (error == null) resolve(destination)
            else reject(error)
          },
          responseHandler: null
        },
        0
      )
    })
  }
}
