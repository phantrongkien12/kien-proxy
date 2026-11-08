'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useSnapshot } from '@/lib/hooks'
import { createClient } from '@/lib/supabase/client'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/overview', label: 'Tổng quan' },
  { href: '/proxies', label: 'Proxy' },
  { href: '/nodes', label: 'VPS' },
  { href: '/activity', label: 'Hoạt động' },
  { href: '/settings', label: 'Cài đặt' },
]

export function Shell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { data } = useSnapshot()
  const [signingOut, setSigningOut] = useState(false)

  const online = data?.stats.nodes_online ?? 0
  const total = data?.stats.nodes_total ?? 0

  async function signOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-1 px-4 sm:px-6">
          <Link href="/overview" className="flex items-center gap-2.5 py-3">
            <span aria-hidden className="grid size-5 place-items-center bg-foreground text-[10px] font-medium text-primary-foreground">
              PL
            </span>
            <span className="font-mono text-[12px] tracking-[0.18em] uppercase">Proxy Ledger</span>
          </Link>

          <nav aria-label="Điều hướng chính" className="order-3 -mb-px flex w-full gap-5 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link key={item.href} href={item.href} className="tab" data-active={active} aria-current={active ? 'page' : undefined}>
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 py-3">
            <span className="hidden items-center gap-1.5 sm:flex">
              <span aria-hidden className={cn('dot', online > 0 ? 'text-foreground' : 'text-muted-foreground')} />
              <span className="num text-[11px] text-muted-foreground">
                {formatNumber(online)}/{formatNumber(total)} VPS
              </span>
            </span>
            <span className="hidden max-w-[180px] truncate text-[11px] text-muted-foreground md:block" title={email}>
              {email}
            </span>
            <button type="button" className="btn btn-ghost" onClick={signOut} disabled={signingOut}>
              {signingOut ? 'Đang thoát' : 'Thoát'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 py-7 sm:px-6 sm:py-9">{children}</main>

      <footer className="mx-auto max-w-[1180px] px-4 pb-10 sm:px-6">
        <p className="border-t border-border pt-4 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          Sổ cái nội bộ · dữ liệu lưu trên Supabase · chỉ tài khoản đã đăng nhập mới đọc được
        </p>
      </footer>
    </div>
  )
}
