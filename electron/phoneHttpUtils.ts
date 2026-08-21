import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_GOVDE_BAYT = 25 * 1024 * 1024

export function govdeSiniriUygula(
  req: IncomingMessage,
  res: ServerResponse,
  maxBayt: number = MAX_GOVDE_BAYT
): void {
  const beyanEdilenUzunluk = Number(req.headers['content-length'] || 0)

  const reddet = () => {
    try {
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ success: false, error: 'Gönderilen veri çok büyük.' }))
      }
    } catch {
      // Yanıt zaten kapanmış olabilir.
    }
    req.destroy()
  }

  if (Number.isFinite(beyanEdilenUzunluk) && beyanEdilenUzunluk > maxBayt) {
    reddet()
    return
  }

  let toplamBayt = 0
  let asildi = false
  req.on('data', (chunk: string | Buffer) => {
    if (asildi) return
    toplamBayt += Buffer.byteLength(chunk as any)
    if (toplamBayt > maxBayt) {
      asildi = true
      console.warn('[PhoneServer] Gövde sınırı aşıldı, istek reddedildi.')
      reddet()
    }
  })
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
