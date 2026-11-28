import type { ReactNode } from 'react'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Logo } from '@/components/logo'

export const dynamic = 'force-dynamic'

/** Sign-in, first setup and invitations. The language choice is here too:
 *  the first screen someone sees may follow a browser set to another language. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-12">
      <div className="flex items-center gap-3">
        <Logo size={32} />
        <span className="font-display text-2xl font-semibold tracking-tight">Octadash</span>
        <div className="ml-auto">
          <LocaleSwitcher />
        </div>
      </div>
      {children}
    </main>
  )
}
