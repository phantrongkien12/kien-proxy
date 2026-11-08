'use client'

import useSWR, { type SWRConfiguration } from 'swr'
import type { ActivityRow, CheckBatchResult, NodeRow, ProxyRow, SearchResult, Snapshot } from './types'

export class ApiError extends Error {}

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? 'Yêu cầu thất bại')
  }
  return (await response.json()) as T
}

export async function post<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/dashboard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new ApiError((body.error as string) ?? 'Yêu cầu thất bại')
  return body as T
}

const live: SWRConfiguration = { refreshInterval: 30000, keepPreviousData: true }

export function useSnapshot() {
  return useSWR<Snapshot>('/api/dashboard?view=overview', fetcher, live)
}

export function useNodes() {
  return useSWR<{ nodes: Array<NodeRow & { created_at: string }>; ownerId: string }>(
    '/api/dashboard?view=nodes',
    fetcher,
    live,
  )
}

export function useActivity() {
  return useSWR<{ activity: Array<{ node_id: string; batch_id: string; accepted: number; created_at: string }> }>(
    '/api/dashboard?view=activity',
    fetcher,
    live,
  )
}

export function useDeadCount() {
  return useSWR<{ dead: number }>('/api/dashboard?view=health', fetcher, live)
}

export function useConfig() {
  return useSWR<{ projectRef: string; fleetToken: boolean; serviceRole: boolean }>(
    '/api/dashboard?view=config',
    fetcher,
  )
}

export type ProxyQuery = {
  q: string
  protocol: string
  node: string
  sort: string
  page: number
  size: number
  secrets: boolean
}

export function proxiesKey(query: ProxyQuery) {
  const params = new URLSearchParams({
    view: 'proxies',
    q: query.q,
    protocol: query.protocol,
    node: query.node,
    sort: query.sort,
    page: String(query.page),
    size: String(query.size),
    secrets: query.secrets ? '1' : '0',
  })
  return `/api/dashboard?${params.toString()}`
}

export function useProxies(query: ProxyQuery) {
  return useSWR<SearchResult>(proxiesKey(query), fetcher, { keepPreviousData: true })
}

export function exportUrl(query: ProxyQuery, format: 'txt' | 'csv') {
  const params = new URLSearchParams({
    view: 'export',
    format,
    q: query.q,
    protocol: query.protocol,
    node: query.node,
    sort: query.sort,
  })
  return `/api/dashboard?${params.toString()}`
}

export type { CheckBatchResult, ProxyRow, ActivityRow }
