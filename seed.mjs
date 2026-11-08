import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase env vars")
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

async function seed() {
  console.log("[v0] Seeding demo VPS nodes and proxies...")

  const nodes = [
    { id: 'wrk_us_east_1', token_hash: 'demo_hash_1', total: 10, last_seen: new Date().toISOString() },
    { id: 'wrk_sg_01', token_hash: 'demo_hash_2', total: 10, last_seen: new Date().toISOString() },
    { id: 'wrk_vn_hanoi_01', token_hash: 'demo_hash_3', total: 10, last_seen: new Date().toISOString() },
    { id: 'wrk_eu_frankfurt_01', token_hash: 'demo_hash_4', total: 10, last_seen: new Date().toISOString() },
  ]

  for (const node of nodes) {
    const { error } = await admin.from('nodes').upsert({
      id: node.id,
      token_hash: node.token_hash,
      total: node.total,
      last_seen: node.last_seen
    }, { onConflict: 'id' })
    if (error) {
      console.error(`Error upserting node ${node.id}:`, error.message)
    }
  }

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

  for (const node of nodes) {
    const batchId = 'batch_' + Math.random().toString(36).slice(2, 10)
    const items = sampleProxies.map(p => ({
      host: p.host,
      port: p.port,
      protocol: p.protocol,
      username: p.username,
      password: p.password
    }))

    const { data, error } = await admin.rpc('ingest_proxy_batch', {
      p_node: node.id,
      p_batch: batchId,
      p_items: items
    })

    if (error) {
      console.error(`Error ingesting for ${node.id}:`, error.message)
    } else {
      console.log(`Successfully ingested batch for ${node.id}:`, data)
    }
  }

  console.log("[v0] Seeding completed successfully!")
}

seed().catch(console.error)
