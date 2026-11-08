import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const WIDTH = 720
const HEIGHT = 190
const PAD_X = 12
const PAD_TOP = 22
const PAD_BOTTOM = 12

export function TrendChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values)
  const innerWidth = WIDTH - PAD_X * 2
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const step = values.length > 1 ? innerWidth / (values.length - 1) : 0
  const baseline = PAD_TOP + innerHeight

  const points = values.map((value, index) => ({
    value,
    x: PAD_X + index * step,
    y: baseline - (value / max) * innerHeight,
  }))

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0])

  return (
    <div className="px-4 pt-4 pb-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Số proxy thu thập mỗi ngày trong ${values.length} ngày, cao nhất ${formatNumber(peak.value)}`}
      >
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={PAD_TOP + innerHeight * ratio}
            y2={PAD_TOP + innerHeight * ratio}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray={ratio === 1 ? undefined : '2 4'}
          />
        ))}

        <path d={area} fill="var(--muted)" />
        <path d={line} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r={2} fill="var(--card)" stroke="var(--foreground)" strokeWidth={1.25} />
        ))}

        <rect x={peak.x - 3} y={peak.y - 3} width={6} height={6} fill="var(--foreground)" />
        <text
          x={Math.min(Math.max(peak.x, PAD_X + 26), WIDTH - PAD_X - 26)}
          y={Math.max(peak.y - 10, 12)}
          textAnchor="middle"
          className="num"
          fontSize={11}
          fill="var(--foreground)"
        >
          {formatNumber(peak.value)}
        </text>
      </svg>

      <div className="mt-2 grid grid-cols-12 font-mono text-[10px] text-muted-foreground">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className={cn('text-center', index % 2 === 1 && 'hidden sm:block')}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
