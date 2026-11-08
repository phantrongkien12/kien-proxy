'use client'

import { useState } from 'react'
import { Field, Panel, PanelHead } from '@/components/ledger'
import { useToast } from '@/components/toast'

const installerUrl = 'https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner/install_worker.sh'

type WorkerSetupProps = {
  issued: { id: string; token: string }
  origin: string
  onHide: () => void
}

export function WorkerSetup({ issued, origin, onHide }: WorkerSetupProps) {
  const { push } = useToast()
  const [editedUrl, setEditedUrl] = useState<string | null>(null)
  const ledgerUrl = editedUrl ?? origin

  function readOrigin(): string | null {
    try {
      const url = new URL(ledgerUrl.trim())
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
        throw new Error('invalid-url')
      }
      return url.origin
    } catch {
      push('Nhập URL HTTPS của dashboard đã deploy, không có đường dẫn hoặc thông tin đăng nhập.', 'error')
      return null
    }
  }

  const oneLiner = `INSTALLER="$(mktemp /tmp/kien-proxy-install.XXXXXX)" && curl -fsSL ${installerUrl} -o "$INSTALLER" && sudo sh "$INSTALLER" --url ${ledgerUrl} --node ${issued.id} --token ${issued.token}`

  const fileCommand = `chmod 600 ./kien-proxy-worker.json &&
INSTALLER="$(mktemp /tmp/kien-proxy-install.XXXXXX)" &&
curl -fsSL ${installerUrl} -o "$INSTALLER" &&
sudo sh "$INSTALLER" --config ./kien-proxy-worker.json`

  function downloadConfig() {
    const origin = readOrigin()
    if (!origin) return
    const config = {
      version: 1,
      url: origin,
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
      push('Clipboard bị chặn. Bôi đen đoạn lệnh rồi copy thủ công.', 'error')
    }
  }

  return (
    <Panel className="border-foreground">
      <PanelHead title={`Cài một lần cho ${issued.id}`} hint="một lệnh, không cần file" />
      <div className="flex flex-col gap-4 px-4 py-4 text-sm leading-relaxed">
        <p className="text-pretty text-muted-foreground">
          Cấu hình dùng token vừa cấp từ tài khoản đang đăng nhập. Token chỉ có ở lần tạo này; copy lệnh trước khi ẩn thẻ.
          VPS lưu lại cấu hình và tự chạy sau reboot, không phải nhập lại.
        </p>
        <Field label="URL dashboard đã deploy" hint="Dùng tên miền production ổn định, không dùng URL preview v0 tạm thời.">
          <input type="url" className="field" value={ledgerUrl} onChange={(event) => setEditedUrl(event.target.value)} placeholder="https://your-app.vercel.app" />
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">SSH vào VPS mới rồi dán đúng một lệnh này:</p>
          <pre className="scroll-x border border-border bg-secondary px-3 py-3 font-mono text-sm leading-relaxed text-secondary-foreground">{oneLiner}</pre>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-solid" onClick={() => void copy(oneLiner, 'lệnh cài một lần')} disabled={!ledgerUrl}>Copy lệnh cài một lần</button>
            <button type="button" className="btn btn-ghost" onClick={onHide}>Đã lưu, ẩn đi</button>
          </div>
        </div>
        <p className="text-pretty text-muted-foreground">
          Lệnh có token nên sẽ nằm trong lịch sử shell của VPS; chạy <code className="font-mono text-foreground">history -c</code> sau khi cài nếu máy có nhiều người dùng.
          Không cần <code className="font-mono text-foreground">git clone</code> và không cần chuyển file lên máy.
        </p>
        <p className="text-pretty text-muted-foreground">
          Máy có systemd hoặc OpenRC thì installer tạo dịch vụ <code className="font-mono text-foreground">kien-proxy</code>.
          Container, LXC hay WSL không có init vẫn cài được: installer chuyển sang chế độ chạy nền và tự đăng ký khởi động lại,
          điều khiển bằng <code className="font-mono text-foreground">sudo kien-proxy status|restart|logs</code>.
        </p>
        <details className="border border-border px-3 py-3">
          <summary className="cursor-pointer text-foreground">Cách khác: dùng file cấu hình (không để token trong lịch sử shell)</summary>
          <div className="flex flex-col gap-3 pt-3">
            <p className="text-pretty text-muted-foreground">
              Tải file, chuyển lên VPS bằng SCP/SFTP, rồi chạy khối lệnh dưới tại thư mục chứa file.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={downloadConfig} disabled={!ledgerUrl}>Tải file cấu hình</button>
              <button type="button" className="btn btn-ghost" onClick={() => void copy(fileCommand, 'lệnh cài bằng file')}>Copy lệnh cài bằng file</button>
            </div>
            <pre className="scroll-x border border-border bg-secondary px-3 py-3 font-mono text-sm leading-relaxed text-secondary-foreground">{fileCommand}</pre>
          </div>
        </details>
        <p className="text-pretty text-muted-foreground">
          File và lệnh đều chứa khóa ghi dữ liệu: không đưa lên GitHub hoặc gửi vào chat. Token cũ không thể đọc lại từ database vì chỉ lưu hash.
          Mỗi VPS dùng một mã/token riêng; không sao chép cùng cấu hình này sang nhiều máy.
        </p>
      </div>
    </Panel>
  )
}
