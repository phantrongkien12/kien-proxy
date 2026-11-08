import { createHash, randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { connectionString } from '@/lib/format'
import { mapWithConcurrency, probeProxy } from '@/lib/probe'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { CheckOutcome, CheckStatus, ProxyRow } from '@/lib/types'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const CHECK_BATCH_SIZE = 10
const CHECK_CONCURRENCY = 3
const EXPORT_LIMIT = 5000

type Admin = ReturnType<typeof createAdminClient>

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

async function checkOne(admin: Admin, row: Pick<ProxyRow, 'id' | 'host' | 'port' | 'protocol' | 'username' | 'password' | 'last_seen'>): Promise<CheckOutcome> {
  const outcome = await probeProxy({
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    username: row.username,
    password: row.password,
  })

  const { data, error } = await admin.rpc('record_proxy_check', {
    p_id: row.id,
    p_seen_at: row.last_seen,
    p_healthy: outcome.healthy,
  })

  if (error) return { id: row.id, status: 'stale', reason: error.message }
  const result = data as { status?: CheckStatus; stale?: boolean } | null
  if (result?.stale) return { id: row.id, status: 'stale', reason: 'Bản ghi đã thay đổi' }
  return { id: row.id, status: result?.status ?? 'untested', reason: outcome.reason }
}

async function collectForExport(admin: Admin, filters: Record<string, unknown>, limit: number) {
  const rows: ProxyRow[] = []
  const pageSize = 500
  let page = 1

  while (rows.length < limit) {
    const { data, error } = await admin.rpc('search_proxies', {
      ...filters,
      p_page: page,
      p_size: pageSize,
      p_secrets: true,
    })
    if (error) throw new Error(error.message)
    const batch = ((data as { proxies?: ProxyRow[] } | null)?.proxies ?? []) as ProxyRow[]
    rows.push(...batch)
    if (batch.length < pageSize) break
    page += 1
  }

  return rows.slice(0, limit)
}

export async function GET(request: NextRequest) {
  const user = await requireUser()
  if (!user) return fail('Chưa đăng nhập', 401)

  const admin = createAdminClient()
  const params = request.nextUrl.searchParams
  const view = params.get('view') ?? 'overview'

  if (view === 'overview') {
    const { data, error } = await admin.rpc('dashboard_snapshot')
    if (error) return fail(error.message, 500)
    return NextResponse.json(data)
  }

  if (view === 'proxies') {
    const { data, error } = await admin.rpc('search_proxies', {
      p_query: params.get('q') ?? '',
      p_protocol: params.get('protocol') ?? 'all',
      p_node: params.get('node') ?? 'all',
      p_page: Number(params.get('page') ?? 1),
      p_size: Number(params.get('size') ?? 15),
      p_secrets: params.get('secrets') === '1',
      p_sort: params.get('sort') ?? 'newest',
    })
    if (error) return fail(error.message, 500)
    return NextResponse.json(data)
  }

  if (view === 'nodes') {
    const { data, error } = await admin
      .from('nodes')
      .select('id,total,last_seen,created_at')
      .order('id', { ascending: true })
    if (error) return fail(error.message, 500)
    return NextResponse.json({ nodes: data ?? [] })
  }

  if (view === 'activity') {
    const { data, error } = await admin
      .from('ingest_batches')
      .select('node_id,batch_id,accepted,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return fail(error.message, 500)
    return NextResponse.json({ activity: data ?? [] })
  }

  if (view === 'health') {
    const { data, error } = await admin.rpc('dead_proxy_count')
    if (error) return fail(error.message, 500)
    return NextResponse.json({ dead: Number(data ?? 0) })
  }

  if (view === 'config') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    return NextResponse.json({
      projectRef: url.replace(/^https?:\/\//, '').split('.')[0] ?? '',
      fleetToken: Boolean(process.env.FLEET_TOKEN),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    })
  }

  if (view === 'export') {
    const format = params.get('format') === 'csv' ? 'csv' : 'txt'
    const filters = {
      p_query: params.get('q') ?? '',
      p_protocol: params.get('protocol') ?? 'all',
      p_node: params.get('node') ?? 'all',
      p_sort: params.get('sort') ?? 'newest',
    }

    let rows: ProxyRow[]
    try {
      rows = await collectForExport(admin, filters, EXPORT_LIMIT)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Không xuất được dữ liệu', 500)
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const body =
      format === 'csv'
        ? [
            'host,port,protocol,username,password,node_id,last_seen,check_status',
            ...rows.map((row) =>
              [row.host, row.port, row.protocol, row.username, row.password, row.node_id, row.last_seen, row.check_status]
                .map((value) => `"${String(value).replace(/"/g, '""')}"`)
                .join(','),
            ),
          ].join('\n')
        : rows.map((row) => connectionString(row, true)).join('\n')

    return new NextResponse(body, {
      headers: {
        'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="proxy-ledger-${stamp}.${format}"`,
        'cache-control': 'no-store',
      },
    })
  }

  return fail('Không rõ view', 404)
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user) return fail('Chưa đăng nhập', 401)

  const admin = createAdminClient()
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return fail('JSON không hợp lệ')
  }

  const action = String(body.action ?? '')

  if (action === 'check') {
    const id = Number(body.id)
    if (!Number.isFinite(id)) return fail('Thiếu id')
    const { data: row, error } = await admin
      .from('proxies')
      .select('id,host,port,protocol,username,password,last_seen')
      .eq('id', id)
      .maybeSingle()
    if (error) return fail(error.message, 500)
    if (!row) return fail('Không tìm thấy proxy', 404)
    const outcome = await checkOne(admin, row as ProxyRow)
    return NextResponse.json({ outcome })
  }

  if (action === 'check-batch') {
    const cursor = Number(body.cursor ?? 0)
    const onlySuspect = Boolean(body.onlySuspect)
    const isFirst = !body.upperBound
    let upperBound = Number(body.upperBound ?? 0)

    if (isFirst) {
      let maxQuery = admin.from('proxies').select('id').order('id', { ascending: false }).limit(1)
      if (onlySuspect) maxQuery = maxQuery.eq('check_status', 'suspect')
      const { data: maxRow, error: maxError } = await maxQuery
      if (maxError) return fail(maxError.message, 500)
      upperBound = Number(maxRow?.[0]?.id ?? 0)
    }

    if (!upperBound) {
      return NextResponse.json({ results: [], cursor: 0, upperBound: 0, total: 0, done: true, healthy: 0, failed: 0 })
    }

    let query = admin
      .from('proxies')
      .select('id,host,port,protocol,username,password,last_seen')
      .gt('id', cursor)
      .lte('id', upperBound)
      .order('id', { ascending: true })
      .limit(CHECK_BATCH_SIZE)
    if (onlySuspect) query = query.eq('check_status', 'suspect')

    const { data: rows, error } = await query
    if (error) return fail(error.message, 500)

    const batch = (rows ?? []) as ProxyRow[]
    const results = await mapWithConcurrency(batch, CHECK_CONCURRENCY, (row) => checkOne(admin, row))
    const nextCursor = batch.length ? batch[batch.length - 1].id : upperBound
    const done = batch.length < CHECK_BATCH_SIZE

    let total: number | null = null
    if (isFirst) {
      let countQuery = admin.from('proxies').select('id', { count: 'exact', head: true }).lte('id', upperBound)
      if (onlySuspect) countQuery = countQuery.eq('check_status', 'suspect')
      const { count } = await countQuery
      total = count ?? 0
    }

    return NextResponse.json({
      results,
      cursor: nextCursor,
      upperBound,
      total,
      done,
      healthy: results.filter((item) => item.status === 'healthy').length,
      failed: results.filter((item) => item.status === 'dead' || item.status === 'suspect').length,
    })
  }

  if (action === 'delete-dead') {
    const { data, error } = await admin.rpc('delete_dead_proxies', { p_limit: 2000 })
    if (error) return fail(error.message, 500)
    return NextResponse.json({ removed: Number(data ?? 0) })
  }

  if (action === 'add-node') {
    const id = String(body.id ?? '').trim()
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) return fail('Mã VPS chỉ gồm chữ, số, dấu chấm, gạch ngang (3-64 ký tự)')
    const token = `pl_${randomBytes(24).toString('hex')}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const { error } = await admin.from('nodes').insert({ id, token_hash: tokenHash })
    if (error) return fail(error.message.includes('duplicate') ? 'Mã VPS đã tồn tại' : error.message, 400)
    return NextResponse.json({ id, token })
  }

  if (action === 'remove-node') {
    const id = String(body.id ?? '').trim()
    if (!id) return fail('Thiếu mã VPS')
    await admin.from('proxies').delete().eq('node_id', id)
    await admin.from('ingest_batches').delete().eq('node_id', id)
    const { error } = await admin.from('nodes').delete().eq('id', id)
    if (error) return fail(error.message, 500)
    return NextResponse.json({ removed: id })
  }

  return fail('Không rõ action', 404)
}
