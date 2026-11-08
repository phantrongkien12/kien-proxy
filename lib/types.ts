export const PROTOCOLS = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'] as const

export type Protocol = (typeof PROTOCOLS)[number]

export type CheckStatus = 'untested' | 'healthy' | 'dead'

export type ProxyRow = {
  id: number
  host: string
  port: number
  protocol: Protocol
  username: string
  password: string
  node_id: string
  last_seen: string
  check_status: CheckStatus
  checked_at: string | null
  check_failures: number
}

export type NodeRow = {
  id: string
  total: number
  last_seen: string | null
  status: 'online' | 'stale'
}

export type ActivityRow = {
  kind: string
  title: string
  detail: string
  at: string
}

export type Snapshot = {
  stats: {
    total: number
    today: number
    unique: number
    nodes_online: number
    nodes_total: number
    trend: number[]
    protocols: Partial<Record<Protocol, number>>
  }
  proxies: Array<Pick<ProxyRow, 'id' | 'host' | 'port' | 'protocol' | 'username' | 'node_id' | 'last_seen'>>
  nodes: NodeRow[]
  activity: ActivityRow[]
}

export type SearchResult = {
  proxies: ProxyRow[]
  pagination: { total: number; page: number; page_size: number }
}

export type CheckOutcome = {
  id: number
  status: Exclude<CheckStatus, 'untested'> | 'stale'
  reason: string
}

export type CheckBatchResult = {
  results: CheckOutcome[]
  cursor: number
  upperBound: number
  /** Only sent on the first batch of a run; the client keeps the last value. */
  total: number | null
  done: boolean
  healthy: number
  failed: number
}

export type IngestPayload = {
  vps_id?: string
  batch_id?: string
  proxies?: Array<{
    host?: string
    port?: number | string
    protocol?: string
    username?: string
    password?: string
  }>
}
