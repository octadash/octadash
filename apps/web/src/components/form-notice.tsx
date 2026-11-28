'use client'

import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { use } from 'react'
import { FormStateContext } from './action-form'

/** Where a form shows a result that keeps it open ("Test email delivered"), with an icon, not only a color. */
export function FormNotice() {
  const notice = use(FormStateContext)?.notice
  return (
    <p role="status" className="flex min-w-0 items-center gap-1.5 text-sm">
      {notice && (
        <>
          {notice.ok ? (
            <CircleCheckIcon className="size-4 shrink-0 text-ok" aria-hidden />
          ) : (
            <TriangleAlertIcon className="size-4 shrink-0 text-error" aria-hidden />
          )}
          <span className={notice.ok ? 'text-ok' : 'text-error'}>{notice.text}</span>
        </>
      )}
    </p>
  )
}
