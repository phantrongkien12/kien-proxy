import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { DM_Mono, Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Proxy Ledger — Sổ cái proxy',
  description:
    'Bảng điều khiển nội bộ để theo dõi kho proxy thu thập từ các VPS: tổng hợp, tìm kiếm, kiểm tra sống chết và xuất danh sách.',
  generator: 'v0.app',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f6f6f4',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" className={`${inter.variable} ${dmMono.variable} bg-background`}>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
