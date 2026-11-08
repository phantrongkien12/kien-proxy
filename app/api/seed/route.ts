import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 })

  const admin = createAdminClient()

  // 1. Insert mock nodes
  const nodes = [
    { id: 'wrk_us_east_1', token_hash: 'demo_hash_1', total: 18, last_seen: new Date().toISOString() },
    { id: 'wrk_sg_01', token_hash: 'demo_hash_2', total: 15, last_seen: new Date().toISOString() },
    { id: 'wrk_vn_hanoi_01', token_hash: 'demo_hash_3', total: 22, last_seen: new Date().toISOString() },
    { id: 'wrk_eu_frankfurt_01', token_hash: 'demo_hash_4', total: 14, last_seen: new Date().toISOString() },
  ]

  const nodeResults = []
  for (const node of nodes) {
    const { error } = await admin.from('nodes').upsert({
      id: node.id,
      token_hash: node.token_hash,
      total: node.total,
      last_seen: node.last_seen
    }, { onConflict: 'id' })
    nodeResults.push({ node: node.id, error: error?.message ?? null })
  }

  // 2. Ingest sample proxies for each node
  const sampleProxies = [
    { host: '103.145.3.12', port: 8080, protocol: 'HTTP', username: 'user1', password: 'pass1' },
    { host: '178.62.204.15', port: 3128, protocol: 'HTTP', username: '', password: '' },
    { host: '45.76.112.89', port: 1080, protocol: 'SOCKS5', username: 'admin', password: 'secretpassword' },
    { host: '198.51.100.42', port: 9050, protocol: 'SOCKS4', username: '', password: '' },
    { host: '103.253.24.11', port: 80, protocol: 'HTTP', username: '', password: '' },
    { host: '185.199.110.153', port: 443, protocol: 'HTTPS', username: 'secureproxy', password: 'mypassword' },
    { host: '202.59.231.10', port: 8080, protocol: 'HTTP', username: '', password: '' },
    { host: '139.162.33.19', port: 3128, protocol: 'HTTP', username: 'proxyuser', password: 'proxy123' },
    { host: '64.225.80.12', port: 1080, protocol: 'SOCKS5', username: '', password: '' },
    { host: '159.65.132.44', port: 9050, protocol: 'SOCKS4', username: '', password: '' },
  ]

  const ingestResults = []
  for (const node of nodes) {
    const batchId = 'batch_' + Math.random().toString(36).slice(2, 10)
    const { data, error } = await admin.rpc('ingest_proxy_batch', {
      p_node: node.id,
      p_batch: batchId,
      p_items: sampleProxies
    })
    ingestResults.push({ node: node.id, batch: batchId, data, error: error?.message ?? null })
  }

  return NextResponse.json({
    success: true,
    message: 'Đã tạo thành công các VPS node mẫu và nạp dữ liệu proxy test!',
    nodes: nodeResults,
    ingest: ingestResults
  })
}
