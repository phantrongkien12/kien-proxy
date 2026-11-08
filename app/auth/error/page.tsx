import Link from 'next/link'

export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="eyebrow">Proxy Ledger</p>
      <h1 className="mt-3 text-[20px] font-medium tracking-tight">Liên kết xác nhận không dùng được</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Liên kết đã hết hạn hoặc đã được dùng trước đó. Hãy đăng nhập lại, hoặc đăng ký lại để nhận liên kết mới.
      </p>
      <Link href="/login" className="btn btn-solid mt-6 self-start">
        Về trang đăng nhập
      </Link>
    </main>
  )
}
