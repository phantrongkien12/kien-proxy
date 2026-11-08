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

async function run() {
  console.log("[*] Đang nạp dữ liệu VPS và proxy mô phỏng vào Supabase...")

  const nodes = [
    { id: 'wrk_us_east_1', token_hash: 'sim_hash_us', total: 45, last_seen: new Date().toISOString() },
    { id: 'wrk_sg_01', token_hash: 'sim_hash_sg', total: 38, last_seen: new Date().toISOString() },
    { id: 'wrk_vn_hanoi_01', token_hash: 'sim_hash_vn', total: 62, last_seen: new Date().toISOString() },
    { id: 'wrk_eu_frankfurt_01', token_hash: 'sim_hash_eu', total: 31, last_seen: new Date().toISOString() },
    { id: 'wrk_jp_tokyo_01', token_hash: 'sim_hash_jp', total: 50, last_seen: new Date().toISOString() },
  ]

  for (const node of nodes) {
    const { error } = await admin.from('nodes').upsert(node, { onConflict: 'id' })
    if (error) console.error(`Error node ${node.id}:`, error.message)
    else console.log(`[+] Upserted node: ${node.id}`)
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
    const batchId = 'batch_' + Math.random().toString(36).substring(2, 10)
    const { data, error } = await admin.rpc('ingest_proxy_batch', {
      p_node: node.id,
      p_batch: batchId,
      p_items: sampleProxies
    })
    if (error) console.error(`Error ingest ${node.id}:`, error.message)
    else console.log(`[+] Ingested batch for ${node.id}:`, data)
  }

  console.log("[*] Hoàn tất nạp dữ liệu VPS & Proxy thành công!")
}

run().catch(console.error)
