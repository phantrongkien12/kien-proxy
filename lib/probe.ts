import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'

const DESTINATION = 'example.com'
const DESTINATION_PORT = 443
const PROBE_TIMEOUT_MS = 6000

export type ProbeTarget = {
  host: string
  port: number
  protocol: string
  username: string
  password: string
}

export type ProbeOutcome = { healthy: boolean; reason: string }

function isPublicIPv4(address: string) {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false
  const [a, b] = parts.map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 0 || b === 168)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  return true
}

/**
 * Resolves the proxy host to a public IPv4 address. The probe connects to the
 * resolved address rather than the hostname so a proxy cannot point us at
 * loopback or link-local space through DNS.
 */
async function resolveTarget(host: string) {
  if (isPublicIPv4(host)) return host
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null
  if (host.length > 253 || !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) return null
  try {
    const addresses = await dns.resolve4(host)
    return addresses.find(isPublicIPv4) ?? null
  } catch {
    return null
  }
}

class ByteReader {
  private chunks: Buffer[] = []
  private size = 0
  private pending: { size: number; resolve: (value: Buffer) => void; reject: (error: Error) => void } | null = null
  private ended = false
  private failure: Error | null = null
  private readonly onData: (chunk: Buffer) => void
  private readonly onEnd: () => void
  private readonly onError: (error: Error) => void

  constructor(private readonly socket: net.Socket) {
    this.onData = (chunk) => {
      this.chunks.push(chunk)
      this.size += chunk.length
      this.pump()
    }
    this.onEnd = () => {
      this.ended = true
      this.pump()
    }
    this.onError = (error) => {
      this.failure = error
      this.pump()
    }
    socket.on('data', this.onData)
    socket.on('end', this.onEnd)
    socket.on('close', this.onEnd)
    socket.on('error', this.onError)
  }

  detach() {
    this.socket.off('data', this.onData)
    this.socket.off('end', this.onEnd)
    this.socket.off('close', this.onEnd)
    this.socket.off('error', this.onError)
  }

  private pump() {
    const pending = this.pending
    if (!pending) return
    if (this.failure) {
      this.pending = null
      pending.reject(this.failure)
      return
    }
    if (this.size >= pending.size) {
      const all = Buffer.concat(this.chunks)
      const head = Buffer.from(all.subarray(0, pending.size))
      const rest = all.subarray(pending.size)
      this.chunks = rest.length ? [rest] : []
      this.size = rest.length
      this.pending = null
      pending.resolve(head)
      return
    }
    if (this.ended) {
      this.pending = null
      pending.reject(new Error('Kết nối bị đóng'))
    }
  }

  read(size: number) {
    return new Promise<Buffer>((resolve, reject) => {
      this.pending = { size, resolve, reject }
      this.pump()
    })
  }

  async readHeader(limit = 8192) {
    const bytes: number[] = []
    while (bytes.length < limit) {
      const [byte] = await this.read(1)
      bytes.push(byte)
      const n = bytes.length
      if (n >= 4 && bytes[n - 4] === 13 && bytes[n - 3] === 10 && bytes[n - 2] === 13 && bytes[n - 1] === 10) {
        return Buffer.from(bytes).toString('latin1')
      }
    }
    throw new Error('Phản hồi quá dài')
  }
}

function connect(host: string, port: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

async function handshake(socket: net.Socket, reader: ByteReader, target: ProbeTarget) {
  if (target.protocol === 'HTTP') {
    socket.write(`CONNECT ${DESTINATION}:${DESTINATION_PORT} HTTP/1.1\r\nHost: ${DESTINATION}:${DESTINATION_PORT}\r\n\r\n`)
    const status = await reader.readHeader()
    if (!/^HTTP\/1\.[01] 200/.test(status)) throw new Error('Proxy từ chối CONNECT')
    return
  }

  if (target.protocol === 'SOCKS5') {
    socket.write(target.username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]))
    const [version, method] = await reader.read(2)
    if (version !== 0x05) throw new Error('Không phải SOCKS5')
    if (method === 0x02) {
      const user = Buffer.from(target.username, 'utf8')
      const pass = Buffer.from(target.password, 'utf8')
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
      const auth = await reader.read(2)
      if (auth[1] !== 0x00) throw new Error('Sai thông tin đăng nhập')
    } else if (method !== 0x00) {
      throw new Error('Phương thức xác thực không được hỗ trợ')
    }
    const host = Buffer.from(DESTINATION, 'utf8')
    socket.write(
      Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
        host,
        Buffer.from([DESTINATION_PORT >> 8, DESTINATION_PORT & 0xff]),
      ]),
    )
    const reply = await reader.read(4)
    if (reply[1] !== 0x00) throw new Error('Proxy từ chối kết nối')
    const addressLength = reply[3] === 0x01 ? 4 : reply[3] === 0x04 ? 16 : (await reader.read(1))[0]
    await reader.read(addressLength + 2)
    return
  }

  if (target.protocol === 'SOCKS4') {
    const host = Buffer.from(DESTINATION, 'utf8')
    const user = Buffer.from(target.username, 'utf8')
    socket.write(
      Buffer.concat([
        Buffer.from([0x04, 0x01, DESTINATION_PORT >> 8, DESTINATION_PORT & 0xff, 0x00, 0x00, 0x00, 0x01]),
        user,
        Buffer.from([0x00]),
        host,
        Buffer.from([0x00]),
      ]),
    )
    const reply = await reader.read(8)
    if (reply[1] !== 0x5a) throw new Error('Proxy từ chối kết nối')
    return
  }

  throw new Error('Giao thức chưa hỗ trợ kiểm tra')
}

export async function probeProxy(target: ProbeTarget): Promise<ProbeOutcome> {
  const address = await resolveTarget(target.host)
  if (!address) return { healthy: false, reason: 'Địa chỉ đích không hợp lệ' }

  let socket: net.Socket | null = null
  let secureSocket: tls.TLSSocket | null = null
  const deadline = setTimeout(() => {
    socket?.destroy()
    secureSocket?.destroy()
  }, PROBE_TIMEOUT_MS)

  try {
    socket = await connect(address, target.port)
    const reader = new ByteReader(socket)
    await handshake(socket, reader, target)

    reader.detach()
    secureSocket = tls.connect({ socket, servername: DESTINATION, rejectUnauthorized: true })
    await new Promise<void>((resolve, reject) => {
      secureSocket!.once('secureConnect', () => resolve())
      secureSocket!.once('error', reject)
    })

    const secureReader = new ByteReader(secureSocket)
    secureSocket.write(`HEAD / HTTP/1.1\r\nHost: ${DESTINATION}\r\nConnection: close\r\n\r\n`)
    const response = await secureReader.readHeader()
    if (!/^HTTP\/1\.[01] \d{3}/.test(response)) throw new Error('Phản hồi không hợp lệ')

    return { healthy: true, reason: 'Hoạt động' }
  } catch (error) {
    return { healthy: false, reason: error instanceof Error ? error.message : 'Lỗi không xác định' }
  } finally {
    clearTimeout(deadline)
    secureSocket?.destroy()
    socket?.destroy()
  }
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await worker(items[current])
    }
  })
  await Promise.all(runners)
  return results
}
