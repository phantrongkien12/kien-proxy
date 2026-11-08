'use client'

import { useState } from 'react'
import { Field, Panel, PanelHead } from '@/components/ledger'
import { useToast } from '@/components/toast'

const installCommand = `chmod 600 ./kien-proxy-worker.json &&
INSTALLER="$(mktemp /tmp/kien-proxy-install.XXXXXX)" &&
curl -fsSL https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner/install_worker.sh -o "$INSTALLER" &&
sudo sh "$INSTALLER" --config ./kien-proxy-worker.json`

type WorkerSetupProps = {
  issued: { id: string; token: string }
  origin: string
  onHide: () => void
}

export function WorkerSetup({ issued, origin, onHide }: WorkerSetupProps) {
  const { push } = useToast()
  const [editedUrl, setEditedUrl] = useState<string | null>(null)
  const ledgerUrl = editedUrl ?? origin

  function downloadConfig() {
    let url: URL
    try {
      url = new URL(ledgerUrl.trim())
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
        throw new Error('invalid-url')
      }
    } catch {
      push('Nhập URL HTTPS của dashboard đã deploy, không có đường dẫn hoặc thông tin đăng nhập.', 'error')
      return
    }

    const config = {
      version: 1,
      url: url.origin,
      node: issued.id,
      token: issued.token,
      options: { SCANNER_AUTO: '1', SCANNER_MODE: 'random' },
    }
    const objectUrl = URL.createObjectURL(new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = 'kien-proxy-worker.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    push('Đã tải cấu hình riêng. Giữ file bí mật và chuyển lên đúng VPS này.')
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      push(`Đã copy ${label}`)
    } catch {
      push('Clipboard bị chặn. Tải file cấu hình để lưu token, hoặc bôi đen lệnh cài để copy.', 'error')
    }
  }

  return (
    <Panel className="border-foreground">
      <PanelHead title={`Cài một lần cho ${issued.id}`} hint="cấu hình riêng" />
      <div className="flex flex-col gap-4 px-4 py-4 text-sm leading-relaxed">
        <p className="text-pretty text-muted-foreground">
          Cấu hình dùng token vừa cấp từ tài khoản đang đăng nhập. Token chỉ có ở lần tạo này; tải file trước khi ẩn thẻ.
          VPS lưu lại cấu hình và tự chạy sau reboot, không phải nhập lại.
        </p>
        <Field label="URL dashboard đã deploy" hint="Dùng tên miền production ổn định, không dùng URL preview v0 tạm thời.">
          <input type="url" className="field" value={ledgerUrl} onChange={(event) => setEditedUrl(event.target.value)} placeholder="https://your-app.vercel.app" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-solid" onClick={downloadConfig} disabled={!ledgerUrl}>Tải cấu hình VPS</button>
          <button type="button" className="btn btn-ghost" onClick={() => void copy(issued.token, 'token riêng')}>Copy token</button>
        </div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
          <li>Chuyển file <code className="font-mono text-foreground">kien-proxy-worker.json</code> lên VPS bằng SCP/SFTP.</li>
          <li>Chạy khối lệnh dưới tại thư mục chứa file. Installer cần root; nếu đã đăng nhập root thì bỏ <code className="font-mono text-foreground">sudo</code>.</li>
          <li>Lần sau chỉ quản lý dịch vụ <code className="font-mono text-foreground">kien-proxy</code>; cấu hình và hàng đợi vẫn được giữ.</li>
        </ol>
        <pre className="scroll-x border border-border bg-secondary px-3 py-3 font-mono text-sm leading-relaxed text-secondary-foreground">{installCommand}</pre>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => void copy(installCommand, 'lệnh cài Linux')}>Copy lệnh cài</button>
          <button type="button" className="btn btn-ghost" onClick={onHide}>Đã lưu, ẩn đi</button>
        </div>
        <p className="text-pretty text-muted-foreground">
          File chứa khóa ghi dữ liệu: không đưa lên GitHub hoặc gửi vào chat. Token cũ không thể đọc lại từ database vì chỉ lưu hash.
          Mỗi VPS dùng một mã/token riêng; không sao chép cùng cấu hình này sang nhiều máy.
        </p>
      </div>
    </Panel>
  )
}
