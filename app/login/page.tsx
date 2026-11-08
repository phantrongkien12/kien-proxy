'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Field, Spinner } from '@/components/ledger'

function describeAuthError(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng.'
  if (lower.includes('email not confirmed')) return 'Email chưa xác nhận. Mở hộp thư và bấm liên kết xác nhận rồi đăng nhập lại.'
  if (lower.includes('password should be at least')) return 'Mật khẩu cần tối thiểu 6 ký tự.'
  if (lower.includes('already registered') || lower.includes('already been registered'))
    return 'Email này đã có tài khoản. Chuyển sang đăng nhập.'
  if (lower.includes('rate limit') || lower.includes('too many')) return 'Thao tác quá nhanh. Thử lại sau ít phút.'
  if (lower.includes('email address') && lower.includes('invalid')) return 'Địa chỉ email không hợp lệ.'
  return 'Không thực hiện được. Kiểm tra kết nối rồi thử lại.'
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    const supabase = createClient()
    const next = searchParams.get('next') ?? '/overview'

    if (mode === 'signup') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo:
            process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
        },
      })
      setBusy(false)
      if (signUpError) {
        setError(describeAuthError(signUpError.message))
        return
      }
      if (data.session) {
        router.replace(next)
        router.refresh()
        return
      }
      setNotice('Đã tạo tài khoản. Mở hộp thư để bấm liên kết xác nhận, rồi quay lại đăng nhập.')
      setMode('signin')
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (signInError) {
      setError(describeAuthError(signInError.message))
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 py-12">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="grid size-5 place-items-center bg-foreground text-[10px] font-medium text-primary-foreground">
          PL
        </span>
        <span className="font-mono text-[12px] tracking-[0.18em] uppercase">Proxy Ledger</span>
      </div>

      <h1 className="mt-8 text-[22px] font-medium tracking-tight text-balance">
        {mode === 'signin' ? 'Đăng nhập sổ cái' : 'Tạo tài khoản quản trị'}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground text-pretty">
        Kho proxy chỉ đọc được bằng tài khoản đã xác thực. Mọi truy vấn đi qua máy chủ, khoá dịch vụ không bao giờ lộ ra
        trình duyệt.
      </p>

      <form onSubmit={submit} className="panel mt-7 flex flex-col gap-4 p-5">
        <Field label="Email">
          <input
            className="field"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ban@ten-mien.com"
          />
        </Field>

        <Field label="Mật khẩu" hint={mode === 'signup' ? 'Tối thiểu 6 ký tự.' : undefined}>
          <input
            className="field"
            type="password"
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </Field>

        {error ? (
          <p role="alert" className="border border-[#e6c9c6] bg-[#fbf1f0] px-3 py-2 text-[12px] leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="border border-border bg-secondary px-3 py-2 text-[12px] leading-relaxed">
            {notice}
          </p>
        ) : null}

        <button type="submit" className="btn btn-solid w-full" disabled={busy}>
          {busy ? <Spinner /> : null}
          {mode === 'signin' ? 'Đăng nhập' : 'Đăng ký'}
        </button>

        <button
          type="button"
          className="btn btn-ghost w-full"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setNotice(null)
          }}
        >
          {mode === 'signin' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </form>

      <p className="mt-5 font-mono text-[10px] leading-relaxed tracking-[0.1em] text-muted-foreground uppercase">
        Supabase Auth · email + mật khẩu
      </p>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
