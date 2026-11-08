'use client'

import Link from 'next/link'
import { Badge, EmptyState, PageHead, Panel, PanelHead, Spinner, Stat } from '@/components/ledger'
import { TrendChart } from '@/components/trend-chart'
import { endpointOf, formatDay, formatNumber, relativeTime } from '@/lib/format'
import { useDeadCount, useSnapshot } from '@/lib/hooks'
import { PROTOCOLS } from '@/lib/types'

function trendLabels(count: number) {
  const today = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (count - 1 - index))
    return formatDay(date.toISOString())
  })
}

export default function OverviewPage() {
  const { data, error, isLoading, mutate } = useSnapshot()
  const { data: health } = useDeadCount()

  const stats = data?.stats
  const trend = stats?.trend ?? []
  const protocols = stats?.protocols ?? {}
  const protocolTotal = PROTOCOLS.reduce((sum, protocol) => sum + (protocols[protocol] ?? 0), 0)
  const isEmpty = !isLoading && (stats?.total ?? 0) === 0

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Sổ cái"
        title="Tổng quan kho proxy"
        description="Số liệu tổng hợp 30 ngày gần nhất, nhịp thu thập theo ngày và tình trạng từng VPS trong đội thu thập."
        action={
          <div className="flex items-center gap-3">
            <span className="num text-[11px] text-muted-foreground">
              {data ? `cập nhật ${relativeTime(new Date().toISOString())}` : 'đang tải'}
            </span>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await fetch('/api/seed', { method: 'POST' })
                void mutate()
              }}
            >
              Seed dữ liệu test
            </button>
            <button type="button" className="btn" onClick={() => void mutate()} disabled={isLoading}>
              {isLoading ? <Spinner /> : null}
              Làm mới
            </button>
          </div>
        }
      />

      {error ? (
        <p role="alert" className="border border-[#e6c9c6] bg-[#fbf1f0] px-3.5 py-2.5 text-[12px] text-destructive">
          {error.message}
        </p>
      ) : null}

      {isEmpty ? (
        <Panel>
          <EmptyState
            title="Sổ cái đang trống"
            body="Chưa có proxy nào được ghi nhận. Đăng ký một VPS để lấy token thu thập, hoặc nhấn nút bên dưới để nạp dữ liệu VPS và proxy test ngay lập tức."
            action={
              <div className="flex items-center gap-3">
                <Link href="/nodes" className="btn btn-solid">
                  Đăng ký VPS
                </Link>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await fetch('/api/seed', { method: 'POST' })
                    void mutate()
                  }}
                >
                  Nạp dữ liệu test ngay
                </button>
              </div>
            }
          />
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Proxy (30 ngày)"
          value={formatNumber(stats?.total)}
          hint={`${formatNumber(stats?.unique)} địa chỉ đang lưu`}
        />
        <Stat label="Thu thập hôm nay" value={formatNumber(stats?.today)} hint="tính theo giờ Việt Nam" />
        <Stat
          label="VPS hoạt động"
          value={`${formatNumber(stats?.nodes_online)}/${formatNumber(stats?.nodes_total)}`}
          hint="gửi dữ liệu trong 2 giờ qua"
        />
        <Stat
          label="Proxy đã chết"
          value={formatNumber(health?.dead)}
          hint="đủ điều kiện xoá khỏi sổ"
          accent={(health?.dead ?? 0) > 0}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Panel>
          <PanelHead title="Nhịp thu thập" hint="12 ngày" />
          {trend.length ? (
            <TrendChart values={trend} labels={trendLabels(trend.length)} />
          ) : (
            <EmptyState title="Chưa có dữ liệu" body="Biểu đồ xuất hiện sau khi VPS gửi lô proxy đầu tiên." />
          )}
        </Panel>

        <Panel>
          <PanelHead title="Phân bố giao thức" hint="30 ngày" />
          <div className="flex flex-col gap-3.5 px-4 py-4">
            {PROTOCOLS.map((protocol) => {
              const count = protocols[protocol] ?? 0
              const share = protocolTotal ? Math.round((count / protocolTotal) * 100) : 0
              return (
                <div key={protocol}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[11px] tracking-[0.08em]">{protocol}</span>
                    <span className="num text-[11px] text-muted-foreground">
                      {formatNumber(count)} · {share}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-muted">
                    <div className="h-full bg-foreground" style={{ width: `${share}%` }} />
                  </div>
                </div>
              )
            })}
            {protocolTotal === 0 ? (
              <p className="text-[12px] text-muted-foreground">Chưa có proxy nào trong 30 ngày gần nhất.</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Panel>
          <PanelHead
            title="Proxy mới nhất"
            action={
              <Link href="/proxies" className="btn btn-ghost">
                Xem tất cả
              </Link>
            }
          />
          {data?.proxies?.length ? (
            <div className="scroll-x">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Địa chỉ</th>
                    <th>Giao thức</th>
                    <th>VPS</th>
                    <th className="text-right">Ghi nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {data.proxies.map((proxy) => (
                    <tr key={proxy.id}>
                      <td className="num">{endpointOf(proxy)}</td>
                      <td>
                        <Badge>{proxy.protocol}</Badge>
                      </td>
                      <td className="font-mono text-[11px] text-muted-foreground">{proxy.node_id}</td>
                      <td className="num text-right text-[11px] text-muted-foreground">{relativeTime(proxy.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Chưa có proxy" body="Dữ liệu sẽ hiện ở đây ngay khi lô đầu tiên được ghi vào sổ." />
          )}
        </Panel>

        <Panel>
          <PanelHead
            title="Trạng thái VPS"
            action={
              <Link href="/nodes" className="btn btn-ghost">
                Quản lý
              </Link>
            }
          />
          {data?.nodes?.length ? (
            <ul className="divide-y divide-border">
              {data.nodes.map((node) => (
                <li key={node.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className={node.status === 'online' ? 'dot text-foreground' : 'dot text-muted-foreground'} />
                    <span className="truncate font-mono text-[12px]">{node.id}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="num text-[11px] text-muted-foreground">{formatNumber(node.total)}</span>
                    <span className="num w-[86px] text-right text-[11px] text-muted-foreground">
                      {relativeTime(node.last_seen)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Chưa có VPS" body="Đăng ký VPS đầu tiên để bắt đầu nhận dữ liệu." />
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHead
          title="Hoạt động gần đây"
          hint="20 lô gần nhất"
          action={
            <Link href="/activity" className="btn btn-ghost">
              Toàn bộ nhật ký
            </Link>
          }
        />
        {data?.activity?.length ? (
          <ul className="divide-y divide-border">
            {data.activity.slice(0, 8).map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <span className="text-[12px]">{entry.title}</span>
                <span className="flex items-baseline gap-3">
                  <span className="num text-[11px] text-muted-foreground">{entry.detail}</span>
                  <span className="num w-[86px] text-right text-[11px] text-muted-foreground">{relativeTime(entry.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Chưa có hoạt động" body="Nhật ký ghi lại mỗi lô dữ liệu mà VPS gửi lên." />
        )}
      </Panel>
    </div>
  )
}
