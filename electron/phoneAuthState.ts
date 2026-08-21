export interface MobileSession {
  token: string
  master_id: number
  name: string
  createdAt: number
  lastActiveAt: number
  ip: string
  userAgent: string
}

export interface PairingTokenInfo {
  token: string
  master_id: number
  master_name: string
  expiresAt: number
  createdAt: number
}

interface FailedLoginRecord {
  count: number
  lockUntil: number
  firstAttemptAt: number
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const activeMobileSessions = new Map<string, MobileSession>()
export const activePairingTokens = new Map<string, PairingTokenInfo>()
const failedLoginAttempts = new Map<string, FailedLoginRecord>()

export function checkLoginRateLimit(ip: string): { locked: boolean; remainingSeconds: number } {
  const record = failedLoginAttempts.get(ip)
  if (!record) return { locked: false, remainingSeconds: 0 }

  if (record.lockUntil > Date.now()) {
    const rem = Math.ceil((record.lockUntil - Date.now()) / 1000)
    return { locked: true, remainingSeconds: rem }
  }

  if (Date.now() - record.firstAttemptAt > 5 * 60 * 1000) {
    failedLoginAttempts.delete(ip)
  }

  return { locked: false, remainingSeconds: 0 }
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now()
  const record = failedLoginAttempts.get(ip) || { count: 0, lockUntil: 0, firstAttemptAt: now }

  if (now - record.firstAttemptAt > 5 * 60 * 1000) {
    record.count = 1
    record.firstAttemptAt = now
    record.lockUntil = 0
  } else {
    record.count += 1
  }

  if (record.count >= 15) record.lockUntil = now + 60 * 1000
  failedLoginAttempts.set(ip, record)
}

export function recordLoginSuccess(ip: string): void {
  failedLoginAttempts.delete(ip)
}

export function suresiDolanKayitlariTemizle(): void {
  const simdi = Date.now()

  for (const [anahtar, bilgi] of activePairingTokens) {
    if (simdi > bilgi.expiresAt) activePairingTokens.delete(anahtar)
  }
  for (const [anahtar, oturum] of activeMobileSessions) {
    if (simdi - oturum.lastActiveAt > SESSION_TTL_MS) activeMobileSessions.delete(anahtar)
  }
  for (const [ip, kayit] of failedLoginAttempts) {
    if (kayit.lockUntil <= simdi && simdi - kayit.firstAttemptAt > 5 * 60 * 1000) {
      failedLoginAttempts.delete(ip)
    }
  }
}

export function getMobileSessionsList(): MobileSession[] {
  suresiDolanKayitlariTemizle()
  return Array.from(activeMobileSessions.values(), (session) => ({ ...session }))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

export function revokeMobileSession(token: string): { success: true } {
  const cleanToken = String(token || '').trim()
  activeMobileSessions.delete(cleanToken)
  for (const [key, session] of activeMobileSessions) {
    if (key === cleanToken || session.token === cleanToken) activeMobileSessions.delete(key)
  }
  return { success: true }
}

export function revokeAllMobileSessions(): { success: true } {
  activeMobileSessions.clear()
  return { success: true }
}
