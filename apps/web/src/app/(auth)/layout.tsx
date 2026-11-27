import type { ReactNode } from 'react'
import { Logo } from '@/components/logo'

export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-12">
      <div className="flex items-center gap-3">
        <Logo size={32} />
        <span className="font-display text-2xl font-semibold tracking-tight">Octadash</span>
      </div>
      {children}
    </main>
  )
}
