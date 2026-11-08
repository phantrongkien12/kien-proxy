import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { IngestPayload } from '@/lib/types'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const NODE_ID_PATTERN = /^[A-Za-z0-9._-]{3,64}$/
const WORKER_ID_PATTERN = /^wrk_[A-Za-z0-9._-]{1,60}$/
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * VPS-facing ingest. Auth is a bearer token in one of three forms: a per-node
 * token issued from the dashboard, the shared FLEET_TOKEN for auto-scaling
 * workers (which self-register as wrk_* nodes), or the account's user id, which
 * lets a machine register itself under the hostname it reports. Tokens are
 * hashed before they ever reach the database, so a leaked table dump cannot be
 * replayed against this endpoint.
 */
export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) return fail('Thiếu token', 401)

  let body: IngestPayload
  try {
    body = (await request.json()) as IngestPayload
  } catch {
    return fail('JSON không hợp lệ')
  }

  const vpsId = String(body.vps_id ?? '').trim()
  const batchId = String(body.batch_id ?? '').trim()
  const items = Array.isArray(body.proxies) ? body.proxies : []

  if (!NODE_ID_PATTERN.test(vpsId)) return fail('vps_id không hợp lệ')
  if (!batchId || batchId.length > 128) return fail('batch_id không hợp lệ')
  if (items.length === 0) return fail('Lô dữ liệu rỗng')
  if (items.length > 500) return fail('Mỗi lô tối đa 500 proxy')

  const admin = createAdminClient()
  const fleetToken = process.env.FLEET_TOKEN
  let nodeId: string | null = null

  if (fleetToken && token === fleetToken) {
    if (!WORKER_ID_PATTERN.test(vpsId)) return fail('vps_id của worker phải có tiền tố wrk_', 403)
    const derived = createHash('sha256').update(`${fleetToken}:${vpsId}`).digest('hex')
    const { error } = await admin.from('nodes').upsert({ id: vpsId, token_hash: derived }, { onConflict: 'id' })
    if (error) return fail(error.message, 500)
    nodeId = vpsId
  } else if (USER_ID_PATTERN.test(token)) {
    // Account-level auto-registration: the bearer token is the owner's user id and
    // the node names itself from the hostname it reports. ignoreDuplicates keeps a
    // machine that was registered by hand on its own token instead of overwriting it.
    const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(token)
    if (ownerError || !owner?.user) return fail('Token không hợp lệ', 401)
    const derived = createHash('sha256').update(`${token}:${vpsId}`).digest('hex')
    const { error } = await admin
      .from('nodes')
      .upsert({ id: vpsId, token_hash: derived }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) return fail(error.message, 500)
    nodeId = vpsId
  } else {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const { data, error } = await admin.from('nodes').select('id').eq('token_hash', tokenHash).maybeSingle()
    if (error) return fail(error.message, 500)
    nodeId = data?.id ?? null
  }

  if (!nodeId) return fail('Token không hợp lệ', 401)
  if (nodeId !== vpsId) return fail('vps_id không khớp với token', 403)

  const { data, error } = await admin.rpc('ingest_proxy_batch', {
    p_node: nodeId,
    p_batch: batchId,
    p_items: items,
  })
  if (error) return fail(error.message, 500)

  return NextResponse.json(data)
}
