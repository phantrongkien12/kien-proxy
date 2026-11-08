import { redirect } from 'next/navigation'
import { CheckJobProvider } from '@/components/check-job'
import { Shell } from '@/components/shell'
import { ToastProvider } from '@/components/toast'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <ToastProvider>
      <CheckJobProvider>
        <Shell email={user.email ?? ''}>{children}</Shell>
      </CheckJobProvider>
    </ToastProvider>
  )
}
