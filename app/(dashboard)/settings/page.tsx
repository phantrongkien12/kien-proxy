'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from 'swr'
import { Badge, PageHead, Panel, PanelHead, Spinner } from '@/components/ledger'
import { useToast } from '@/components/toast'
import { formatNumber } from '@/lib/format'
import { post, useConfig, useDeadCount, useSnapshot } from '@/lib/hooks'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const { push } = useToast()
  const { data: config } = useConfig()
  const { data: health } = useDeadCount()
  const { data: snapshot } = useSnapshot()

  const [email, setEmail] = useState('')
  const [origin, setOrigin] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
  }, [])

  async function run(key: string, payload: Record<string, unknown>, success: (result: Record<string, unknown>) => string) {
    setBusy(key)
    try {
      const result = await post<Record<string, unknown>>(payload)
      push(success(result))
      await mutate('/api/dashboard?view=overview')
      await mutate('/api/dashboard?view=health')
      await mutate('/api/dashboard?view=nodes')
      await mutate('/api/dashboard?view=activity')
      await mutate((cacheKey) => typeof cacheKey === 'string' && cacheKey.startsWith('/api/dashboard?view=proxies'))
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Thao tác thất bại', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const demoNode = snapshot?.nodes.find((node) => node.id === 'DEMO-01')

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Cấu hình"
        title="Cài đặt sổ cái"
        description="Tài khoản quản trị, kết nối Supabase, đường thu thập dữ liệu và các thao tác dọn dẹp kho proxy."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Tài khoản" hint="Supabase Auth" />
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">Email</span>
              <span className="num truncate text-[12px]">{email || '—'}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">Phiên</span>
              <Badge tone="solid">
                <span aria-hidden className="dot" />
                đã đăng nhập
              </Badge>
            </div>
            <button type="button" className="btn self-start" onClick={() => void signOut()}>
              Đăng xuất
            </button>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Kết nối" hint="Supabase" />
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">Project ref</span>
              <span className="num truncate text-[12px]">{config?.projectRef || '—'}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">Khoá dịch vụ</span>
              <Badge tone={config?.serviceRole ? 'solid' : 'danger'}>
                {config?.serviceRole ? 'đã cấu hình' : 'thiếu'}
              </Badge>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">FLEET_TOKEN</span>
              <Badge tone={config?.fleetToken ? 'solid' : 'plain'}>
                {config?.fleetToken ? 'đã cấu hình' : 'chưa đặt'}
              </Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground text-pretty">
              Bảng <span className="num">nodes</span>, <span className="num">proxies</span> và{' '}
              <span className="num">ingest_batches</span> đều bật RLS và không có policy: chỉ máy chủ dùng khoá dịch vụ
              mới đọc được. Trình duyệt không bao giờ chạm thẳng vào bảng.
            </p>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHead title="Đường thu thập" hint="POST /api/ingest" />
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="num break-all border border-border bg-secondary px-3 py-2.5 text-[12px]">
            {origin ? `${origin}/api/ingest` : '/api/ingest'}
          </p>
          <p className="text-[12px] leading-relaxed text-muted-foreground text-pretty">
            VPS xác thực bằng header <span className="num text-foreground">Authorization: Bearer &lt;token&gt;</span>.
            Token riêng cho từng VPS tạo ở trang VPS. Nếu chạy nhiều worker tự động, đặt{' '}
            <span className="num text-foreground">FLEET_TOKEN</span> trong biến môi trường của dự án rồi cho worker dùng
            chung token đó với <span className="num text-foreground">vps_id</span> tiền tố{' '}
            <span className="num text-foreground">wrk_</span>.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Dữ liệu" hint="dọn dẹp và dữ liệu mẫu" />
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium">Xoá proxy đã chết</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatNumber(health?.dead)} proxy lỗi hai lần liên tiếp và chưa được ghi nhận lại.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === 'purge' || (health?.dead ?? 0) === 0}
              onClick={() =>
                void run('purge', { action: 'delete-dead' }, (result) =>
                  `Đã xoá ${formatNumber(Number(result.removed ?? 0))} proxy chết`,
                )
              }
            >
              {busy === 'purge' ? <Spinner /> : null}
              Xoá
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <p className="text-[12px] font-medium">Dữ liệu mẫu</p>
              <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-muted-foreground text-pretty">
                Nạp khoảng 560 proxy giả để xem giao diện hoạt động. Toàn bộ dùng dải IP tài liệu RFC 5737
                (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) nên không trỏ tới máy thật nào.
                {demoNode ? ` Hiện có ${formatNumber(demoNode.total)} dòng mẫu.` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy === 'seed'}
                onClick={() =>
                  void run('seed', { action: 'seed' }, (result) =>
                    `Đã nạp ${formatNumber(Number(result.seeded ?? 0))} proxy mẫu`,
                  )
                }
              >
                {busy === 'seed' ? <Spinner /> : null}
                Nạp dữ liệu mẫu
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy === 'unseed' || !demoNode}
                onClick={() => void run('unseed', { action: 'unseed' }, () => 'Đã xoá toàn bộ dữ liệu mẫu')}
              >
                {busy === 'unseed' ? <Spinner /> : null}
                Xoá dữ liệu mẫu
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Cách sổ cái hoạt động" />
        <ul className="flex flex-col gap-3 px-4 py-4 text-[12px] leading-relaxed text-muted-foreground">
          <li className="text-pretty">
            <span className="text-foreground">Ghi vào sổ</span> — VPS gửi lô qua /api/ingest. Mỗi lô có batch_id riêng
            nên gửi lại không nhân bản dữ liệu; proxy trùng được cập nhật và đánh dấu chưa kiểm tra lại.
          </li>
          <li className="text-pretty">
            <span className="text-foreground">Kiểm tra sức khoẻ</span> — mỗi proxy được thử bằng kết nối TCP thật xuyên
            qua proxy tới example.com:443 kèm bắt tay TLS. Lỗi lần đầu là &ldquo;nghi ngờ&rdquo;, lỗi lần hai là
            &ldquo;đã chết&rdquo;.
          </li>
          <li className="text-pretty">
            <span className="text-foreground">Dọn dẹp</span> — chỉ proxy đã chết và không được ghi nhận lại sau lần
            kiểm tra cuối mới bị xoá, nên một lần mạng chập chờn không làm mất dữ liệu tốt.
          </li>
        </ul>
      </Panel>
    </div>
  )
}
