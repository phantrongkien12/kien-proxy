'use client'

import { useMemo } from 'react'
import { EmptyState, PageHead, Panel, PanelHead, Stat } from '@/components/ledger'
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format'
import { useActivity } from '@/lib/hooks'

export default function ActivityPage() {
  const { data, error, isLoading } = useActivity()
  const entries = data?.activity ?? []

  const groups = useMemo(() => {
    const map = new Map<string, typeof entries>()
    for (const entry of entries) {
      const key = new Date(entry.created_at).toDateString()
      const bucket = map.get(key)
      if (bucket) bucket.push(entry)
      else map.set(key, [entry])
    }
    return Array.from(map.entries())
  }, [entries])

  const totalAccepted = entries.reduce((sum, entry) => sum + entry.accepted, 0)
  const activeNodes = new Set(entries.map((entry) => entry.node_id)).size

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Nhật ký"
        title="Hoạt động thu thập"
        description="Mỗi dòng là một lô proxy mà VPS gửi lên. Nhật ký giúp phát hiện VPS im lặng hoặc lô bị trùng."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lô gần đây" value={formatNumber(entries.length)} hint="200 lô mới nhất" />
        <Stat label="Proxy đã nhận" value={formatNumber(totalAccepted)} hint="tổng trong 200 lô" />
        <Stat label="VPS có gửi" value={formatNumber(activeNodes)} hint="trong 200 lô gần nhất" />
        <Stat
          label="Lô lớn nhất"
          value={formatNumber(entries.reduce((max, entry) => Math.max(max, entry.accepted), 0))}
          hint="proxy trong một lô"
        />
      </div>

      {error ? (
        <p role="alert" className="border border-[#e6c9c6] bg-[#fbf1f0] px-3.5 py-2.5 text-[12px] text-destructive">
          {error.message}
        </p>
      ) : null}

      {groups.length ? (
        <div className="flex flex-col gap-3">
          {groups.map(([day, dayEntries]) => (
            <Panel key={day}>
              <PanelHead
                title={new Date(day).toLocaleDateString('vi-VN', {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
                hint={`${formatNumber(dayEntries.length)} lô · ${formatNumber(
                  dayEntries.reduce((sum, entry) => sum + entry.accepted, 0),
                )} proxy`}
              />
              <ul className="divide-y divide-border">
                {dayEntries.map((entry) => (
                  <li
                    key={`${entry.node_id}-${entry.batch_id}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5"
                  >
                    <span className="flex min-w-0 items-baseline gap-2.5">
                      <span className="font-mono text-[12px]">{entry.node_id}</span>
                      <span className="num truncate text-[11px] text-muted-foreground">{entry.batch_id}</span>
                    </span>
                    <span className="flex items-baseline gap-4">
                      <span className="num text-[11px]">{formatNumber(entry.accepted)} proxy</span>
                      <span className="num w-[92px] text-right text-[11px] text-muted-foreground" title={formatDateTime(entry.created_at)}>
                        {relativeTime(entry.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            title={isLoading ? 'Đang tải nhật ký' : 'Chưa có lô nào'}
            body="Nhật ký sẽ đầy lên ngay khi VPS đầu tiên gửi dữ liệu qua /api/ingest."
          />
        </Panel>
      )}
    </div>
  )
}
