import type { CheckStatus, ProxyRow } from './types'

const numberFormat = new Intl.NumberFormat('vi-VN')

const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dayFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' })

export function formatNumber(value: number | null | undefined) {
  return numberFormat.format(Number(value ?? 0))
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTimeFormat.format(date)
}

export function formatDay(iso: string | null | undefined) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return dayFormat.format(date)
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return 'chưa ghi nhận'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'chưa ghi nhận'
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'vừa xong'
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} ngày trước`
  return formatDateTime(iso)
}

export function endpointOf(proxy: Pick<ProxyRow, 'host' | 'port'>) {
  return `${proxy.host}:${proxy.port}`
}

export function connectionString(proxy: Pick<ProxyRow, 'protocol' | 'host' | 'port' | 'username' | 'password'>, withSecrets = false) {
  const scheme = proxy.protocol.toLowerCase()
  const credentials = withSecrets && proxy.username ? `${proxy.username}:${proxy.password}@` : ''
  return `${scheme}://${credentials}${proxy.host}:${proxy.port}`
}

export const CHECK_LABELS: Record<CheckStatus, string> = {
  untested: 'chưa kiểm tra',
  healthy: 'sống',
  dead: 'chết',
}

export function checkTone(status: CheckStatus): 'solid' | 'plain' | 'danger' {
  if (status === 'healthy') return 'solid'
  if (status === 'dead') return 'danger'
  return 'plain'
}
