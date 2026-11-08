'use client'

import { useEffect, useState } from 'react'
import { mutate } from 'swr'
import { Badge, EmptyState, Field, PageHead, Panel, PanelHead, Spinner } from '@/components/ledger'
import { useToast } from '@/components/toast'
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format'
import { post, useNodes } from '@/lib/hooks'

type Issued = { id: string; token: string }

export default function NodesPage() {
  const { push } = useToast()
  const { data, error, isLoading, mutate: revalidate } = useNodes()
  const [nodeId, setNodeId] = useState('')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const nodes = data?.nodes ?? []

  async function createNode(event: React.FormEvent) {
    event.preventDefault()
    setCreating(true)
    try {
      const result = await post<Issued>({ action: 'add-node', id: nodeId.trim() })
      setIssued(result)
      setNodeId('')
      push(`Đã tạo VPS ${result.id}. Sao chép token ngay — token chỉ hiện một lần.`)
      await revalidate()
      await mutate('/api/dashboard?view=overview')
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Không tạo được VPS', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function removeNode(id: string) {
    setRemoving(id)
    try {
      await post({ action: 'remove-node', id })
      push(`Đã xoá VPS ${id} cùng toàn bộ proxy của nó`)
      await revalidate()
      await mutate('/api/dashboard?view=overview')
      await mutate('/api/dashboard?view=proxies')
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Không xoá được VPS', 'error')
    } finally {
      setRemoving(null)
    }
  }

  async function sendTestBatch(id: string) {
    setTesting(id)
    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vps_id: id,
          batch_id: `selftest-${Date.now()}`,
          proxies: [{ host: '192.0.2.1', port: 8080, protocol: 'HTTP', username: '', password: '' }],
        }),
      })
      const body = (await response.json().catch(() => ({}))) as { accepted?: number; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Lô thử thất bại')
      push(`Lô thử được nhận: ${formatNumber(body.accepted ?? 0)} proxy ghi vào sổ`)
      await revalidate()
      await mutate('/api/dashboard?view=overview')
      await mutate('/api/dashboard?view=proxies')
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Lô thử thất bại', 'error')
    } finally {
      setTesting(null)
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      push('Đã copy token')
    } catch {
      push('Trình duyệt chặn clipboard. Hãy bôi đen và copy thủ công.', 'error')
    }
  }

  const curlSnippet = `curl -X POST ${origin || 'https://<ten-mien>'}/api/ingest \\
  -H "Authorization: Bearer ${issued?.token ?? '<TOKEN>'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vps_id": "${issued?.id ?? 'VPS-01'}",
    "batch_id": "'"$(date +%s)"'",
    "proxies": [
      { "host": "203.0.113.10", "port": 8080, "protocol": "HTTP", "username": "", "password": "" }
    ]
  }'`

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Đội thu thập"
        title="VPS và token thu thập"
        description="Mỗi VPS có một token riêng để gửi proxy lên sổ cái. Token được băm trước khi lưu, nên chỉ hiện đúng một lần lúc tạo."
      />

      {issued ? (
        <Panel className="border-foreground">
          <PanelHead
            title={`Token của ${issued.id}`}
            hint="chỉ hiện một lần"
            action={
              <button type="button" className="btn btn-solid" onClick={() => void copyToken(issued.token)}>
                Copy token
              </button>
            }
          />
          <div className="px-4 py-4">
            <p className="num break-all border border-border bg-secondary px-3 py-2.5 text-[12px]">{issued.token}</p>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground text-pretty">
              Dán token vào biến môi trường trên VPS. Nếu để lộ, hãy xoá VPS này và tạo lại để thu hồi token cũ.
            </p>
            <pre className="scroll-x mt-3 border border-border bg-secondary px-3 py-2.5 font-mono text-[11px] leading-relaxed">
              {curlSnippet}
            </pre>
            <button type="button" className="btn btn-ghost mt-3" onClick={() => setIssued(null)}>
              Đã lưu, ẩn đi
            </button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Panel>
          <PanelHead title="Đăng ký VPS mới" />
          <form onSubmit={createNode} className="flex flex-col gap-4 px-4 py-4">
            <Field label="Mã VPS" hint="Chữ, số, dấu chấm, gạch ngang. 3–64 ký tự. Ví dụ: VPS-HN-01">
              <input
                className="field"
                value={nodeId}
                onChange={(event) => setNodeId(event.target.value)}
                placeholder="VPS-HN-01"
                required
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9._\-]{3,64}"
              />
            </Field>
            <button type="submit" className="btn btn-solid self-start" disabled={creating}>
              {creating ? <Spinner /> : null}
              Tạo token
            </button>
          </form>
        </Panel>

        <Panel>
          <PanelHead title="Cách VPS gửi dữ liệu" hint="POST /api/ingest" />
          <div className="flex flex-col gap-3 px-4 py-4 text-[12px] leading-relaxed text-muted-foreground">
            <p className="text-pretty">
              Gửi tối đa 500 proxy mỗi lô. Mỗi lô cần một <span className="num text-foreground">batch_id</span> riêng:
              gửi lại cùng batch_id sẽ bị bỏ qua, nên VPS có thể thử lại an toàn khi mạng chập chờn.
            </p>
            <p className="text-pretty">
              Proxy trùng <span className="num text-foreground">host + cổng + giao thức + tài khoản</span> sẽ được cập
              nhật thay vì nhân bản, và được đánh dấu chưa kiểm tra lại.
            </p>
            <p className="text-pretty">
              Nếu chạy nhiều worker tự động, đặt biến môi trường{' '}
              <span className="num text-foreground">FLEET_TOKEN</span> cho dự án và cho worker dùng chung token đó với{' '}
              <span className="num text-foreground">vps_id</span> có tiền tố <span className="num text-foreground">wrk_</span>.
              Worker sẽ tự đăng ký khi gửi lô đầu tiên.
            </p>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHead title="Danh sách VPS" hint={`${formatNumber(nodes.length)} nút`} />
        {error ? (
          <p role="alert" className="px-4 py-3 text-[12px] text-destructive">
            {error.message}
          </p>
        ) : null}
        {nodes.length ? (
          <div className="scroll-x">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Mã VPS</th>
                  <th>Trạng thái</th>
                  <th className="text-right">Tổng proxy</th>
                  <th>Lần gửi cuối</th>
                  <th>Ngày tạo</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => {
                  const online = node.last_seen ? Date.now() - new Date(node.last_seen).getTime() < 7200000 : false
                  return (
                    <tr key={node.id}>
                      <td className="font-mono text-[12px]">{node.id}</td>
                      <td>
                        <Badge tone={online ? 'solid' : 'plain'}>
                          {online ? <span aria-hidden className="dot" /> : null}
                          {online ? 'hoạt động' : 'im lặng'}
                        </Badge>
                      </td>
                      <td className="num text-right">{formatNumber(node.total)}</td>
                      <td className="num text-[11px] text-muted-foreground" title={formatDateTime(node.last_seen)}>
                        {relativeTime(node.last_seen)}
                      </td>
                      <td className="num text-[11px] text-muted-foreground">{formatDateTime(node.created_at)}</td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void sendTestBatch(node.id)}
                            disabled={testing === node.id}
                          >
                            {testing === node.id ? <Spinner /> : null}
                            Gửi lô thử
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void removeNode(node.id)}
                            disabled={removing === node.id}
                          >
                            {removing === node.id ? <Spinner /> : null}
                            Xoá
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={isLoading ? 'Đang tải' : 'Chưa có VPS nào'}
            body="Tạo VPS đầu tiên ở khung bên trên, rồi dán token vào script thu thập trên máy đó."
          />
        )}
      </Panel>
    </div>
  )
}
