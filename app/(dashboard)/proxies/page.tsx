'use client'

import { useEffect, useRef, useState } from 'react'
import { mutate } from 'swr'
import { useCheckJob } from '@/components/check-job'
import { Badge, EmptyState, Field, PageHead, Panel, PanelHead, Spinner } from '@/components/ledger'
import { useToast } from '@/components/toast'
import {
  CHECK_LABELS,
  checkTone,
  connectionString,
  endpointOf,
  formatDateTime,
  formatNumber,
  relativeTime,
} from '@/lib/format'
import { exportUrl, post, useDeadCount, useNodes, useProxies, type ProxyQuery } from '@/lib/hooks'
import { PROTOCOLS, type CheckOutcome, type ProxyRow } from '@/lib/types'

const PAGE_SIZES = [15, 30, 60, 120]

function statusLabel(status: string) {
  return (CHECK_LABELS as Record<string, string>)[status] ?? status
}

export default function ProxiesPage() {
  const { push } = useToast()
  const { state: job, start, resume, stop, reset } = useCheckJob()
  const { data: nodeData } = useNodes()
  const { data: health } = useDeadCount()

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState('all')
  const [node, setNode] = useState('all')
  const [sort, setSort] = useState('newest')
  const [size, setSize] = useState(15)
  const [page, setPage] = useState(1)
  const [secrets, setSecrets] = useState(false)
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [purging, setPurging] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const appliedRef = useRef('')

  useEffect(() => {
    const timer = setTimeout(() => {
      if (appliedRef.current === search) return
      appliedRef.current = search
      setQuery(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const proxyQuery: ProxyQuery = { q: query, protocol, node, sort, page, size, secrets }
  const { data, error, isLoading, mutate: revalidate } = useProxies(proxyQuery)

  const rows = data?.proxies ?? []
  const total = data?.pagination.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(page * size, total)
  const percent = job.total ? Math.min(100, Math.round((job.checked / job.total) * 100)) : 0
  const deadCount = health?.dead ?? 0
  const totalCount = health?.total ?? 0

  useEffect(() => {
    if (!confirmWipe) return
    const timer = setTimeout(() => setConfirmWipe(false), 6000)
    return () => clearTimeout(timer)
  }, [confirmWipe])

  async function checkOne(proxy: ProxyRow) {
    setCheckingId(proxy.id)
    try {
      const result = await post<{ outcome: CheckOutcome }>({ action: 'check', id: proxy.id })
      push(`#${proxy.id} ${endpointOf(proxy)} — ${statusLabel(result.outcome.status)}: ${result.outcome.reason}`)
      await revalidate()
      await mutate('/api/dashboard?view=overview')
      await mutate('/api/dashboard?view=health')
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Không kiểm tra được', 'error')
    } finally {
      setCheckingId(null)
    }
  }

  async function copy(proxy: ProxyRow) {
    try {
      await navigator.clipboard.writeText(connectionString(proxy, secrets))
      push(`Đã copy ${endpointOf(proxy)}`)
    } catch {
      push('Trình duyệt chặn clipboard. Hãy bôi đen và copy thủ công.', 'error')
    }
  }

  async function purgeDead() {
    setPurging(true)
    try {
      const result = await post<{ removed: number }>({ action: 'delete-dead' })
      push(`Đã xoá ${formatNumber(result.removed)} proxy chết khỏi sổ`)
      await revalidate()
      await mutate('/api/dashboard?view=overview')
      await mutate('/api/dashboard?view=health')
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Không xoá được', 'error')
    } finally {
      setPurging(false)
    }
  }

  async function wipeAll() {
    setWiping(true)
    try {
      const result = await post<{ removed: number }>({ action: 'delete-all' })
      push(`Đã xoá toàn bộ ${formatNumber(result.removed)} proxy khỏi sổ`)
      setConfirmWipe(false)
      await revalidate()
      await mutate('/api/dashboard?view=overview')
      await mutate('/api/dashboard?view=health')
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Không xoá được', 'error')
    } finally {
      setWiping(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Kho dữ liệu"
        title="Danh sách proxy"
        description="Tìm kiếm, lọc và kiểm tra sống chết từng proxy. Mật khẩu chỉ được trả về khi bạn bật hiển thị, và mọi truy vấn đều chạy phía máy chủ."
        action={
          <div className="flex flex-wrap gap-2">
            <a className="btn" href={exportUrl(proxyQuery, 'txt')} download>
              Xuất TXT
            </a>
            <a className="btn" href={exportUrl(proxyQuery, 'csv')} download>
              Xuất CSV
            </a>
          </div>
        }
      />

      <Panel>
        <PanelHead
          title="Kiểm tra sức khoẻ"
          hint="TCP + TLS thật"
          action={
            <div className="flex flex-wrap gap-2">
              {job.running ? (
                <button type="button" className="btn" onClick={stop}>
                  Dừng
                </button>
              ) : job.resumable ? (
                <button type="button" className="btn btn-solid" onClick={resume}>
                  Tiếp tục kiểm tra
                </button>
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => start(true)}>
                    Kiểm tra lại proxy chết
                  </button>
                  <button type="button" className="btn btn-solid" onClick={() => start(false)}>
                    Kiểm tra tất cả
                  </button>
                </>
              )}
              {!job.running && (job.checked > 0 || job.resumable) ? (
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  Xoá tiến trình
                </button>
              ) : null}
            </div>
          }
        />
        <div className="px-4 py-4">
          {job.running || job.checked > 0 || job.resumable ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="num text-[12px]">
                  {formatNumber(job.checked)}/{formatNumber(job.total)} proxy
                  {job.onlyDead ? ' chết' : ''}
                </span>
                <span className="num text-[11px] text-muted-foreground">
                  {percent}% · {formatNumber(job.healthy)} sống · {formatNumber(job.failed)} chết
                  {job.running ? ' · đang chạy' : job.resumable ? ' · tạm dừng' : ' · hoàn tất'}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full bg-muted">
                <div className="h-full bg-foreground transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
            </>
          ) : (
            <p className="max-w-3xl text-[12px] leading-relaxed text-muted-foreground text-pretty">
              Mỗi proxy được kiểm tra bằng một kết nối TCP thật xuyên qua proxy tới example.com:443, kèm bắt tay TLS để
              xác nhận đường truyền thông suốt. Kiểm tra thành công ghi Sống; kết nối lỗi hoặc hết thời gian chờ ghi
              Chết ngay. Proxy chết có thể kiểm tra lại hoặc xoá. Proxy chưa được kiểm tra không được gán kết quả.
            </p>
          )}

          {job.recent.length ? (
            <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
              {job.recent.map((item, index) => (
                <li key={`${item.id}-${index}`} className="flex items-baseline gap-2 text-[11px]">
                  <span className="num text-muted-foreground">#{item.id}</span>
                  <span className="text-destructive">{item.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {job.error ? (
            <p role="alert" className="mt-3 border border-[#e6c9c6] bg-[#fbf1f0] px-3 py-2 text-[12px] text-destructive">
              {job.error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="num text-[11px] text-muted-foreground">
              {formatNumber(deadCount)} proxy chết có thể xoá
            </span>
            <button type="button" className="btn btn-danger" onClick={purgeDead} disabled={purging || deadCount === 0}>
              {purging ? <Spinner /> : null}
              Xoá proxy chết
            </button>
            {confirmWipe ? (
              <>
                <span role="alert" className="text-[11px] text-destructive">
                  Xoá vĩnh viễn toàn bộ {formatNumber(totalCount)} proxy, không khôi phục được.
                </span>
                <button type="button" className="btn btn-danger" onClick={wipeAll} disabled={wiping}>
                  {wiping ? <Spinner /> : null}
                  Xác nhận xoá tất cả
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmWipe(false)}
                  disabled={wiping}
                >
                  Huỷ
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmWipe(true)}
                disabled={wiping || totalCount === 0}
              >
                Xoá tất cả
              </button>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="grid gap-3 border-b border-border px-4 py-4 sm:grid-cols-3">
          <Field label="Tìm kiếm" className="sm:col-span-3">
            <input
              className="field"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="host, cổng hoặc mã VPS"
            />
          </Field>

          <Field label="Giao thức">
            <select
              className="field"
              value={protocol}
              onChange={(event) => {
                setProtocol(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">Tất cả</option>
              {PROTOCOLS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>

          <Field label="VPS">
            <select
              className="field"
              value={node}
              onChange={(event) => {
                setNode(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">Tất cả</option>
              {(nodeData?.nodes ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sắp xếp">
            <select
              className="field"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value)
                setPage(1)
              }}
            >
              <option value="newest">Mới ghi nhận trước</option>
              <option value="oldest">Cũ nhất trước</option>
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              className="size-3.5 accent-[#16171a]"
              checked={secrets}
              onChange={(event) => setSecrets(event.target.checked)}
            />
            Hiện mật khẩu
          </label>
          <span className="num text-[11px] text-muted-foreground">
            {total === 0 ? 'không có kết quả' : `${formatNumber(from)}–${formatNumber(to)} / ${formatNumber(total)}`}
          </span>
        </div>

        {error ? (
          <p role="alert" className="px-4 py-3 text-[12px] text-destructive">
            {error.message}
          </p>
        ) : null}

        {rows.length ? (
          <div className="scroll-x">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="w-[64px]">#</th>
                  <th>Địa chỉ</th>
                  <th>Giao thức</th>
                  <th>VPS</th>
                  <th>Ghi nhận</th>
                  <th>Sức khoẻ</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((proxy) => (
                  <tr key={proxy.id}>
                    <td className="num text-[11px] text-muted-foreground">{proxy.id}</td>
                    <td>
                      <span className="num">{endpointOf(proxy)}</span>
                      {proxy.username ? (
                        <span className="num mt-0.5 block text-[11px] text-muted-foreground">
                          {proxy.username}
                          {secrets && proxy.password ? `:${proxy.password}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Badge>{proxy.protocol}</Badge>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{proxy.node_id}</td>
                    <td className="num text-[11px] text-muted-foreground" title={formatDateTime(proxy.last_seen)}>
                      {relativeTime(proxy.last_seen)}
                    </td>
                    <td>
                      <Badge tone={checkTone(proxy.check_status)}>
                        {proxy.check_status === 'healthy' ? <span aria-hidden className="dot" /> : null}
                        {CHECK_LABELS[proxy.check_status]}
                      </Badge>
                      {proxy.checked_at ? (
                        <span className="num mt-0.5 block text-[10px] text-muted-foreground">
                          {relativeTime(proxy.checked_at)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className="btn" onClick={() => void copy(proxy)}>
                          Copy
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void checkOne(proxy)}
                          disabled={checkingId === proxy.id}
                        >
                          {checkingId === proxy.id ? <Spinner /> : null}
                          Kiểm tra
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={isLoading ? 'Đang tải' : 'Không có proxy nào khớp'}
            body={
              isLoading
                ? 'Đang đọc sổ cái.'
                : 'Thử xoá bộ lọc, hoặc đăng ký thêm VPS để thu thập dữ liệu mới.'
            }
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Mỗi trang</span>
            <select
              className="field w-[76px]"
              value={size}
              onChange={(event) => {
                setSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {PAGE_SIZES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="num text-[11px] text-muted-foreground">
              trang {formatNumber(page)}/{formatNumber(pageCount)}
            </span>
            <button type="button" className="btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
              Trước
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount}
            >
              Sau
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
