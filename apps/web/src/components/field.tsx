import { cloneElement, isValidElement, type ReactNode, useId } from 'react'
import { InfoTip } from './info-tip'

/**
 * A label and one form control, with an optional hint below it. With `info`,
 * an "i" next to the label opens the longer explanation; the label then points
 * to the control by id, so the button stays out of it.
 */
export function Field({
  label,
  hint,
  info,
  children,
}: {
  label: string
  hint?: ReactNode
  info?: { label: string; title?: string; body: ReactNode }
  children: ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  if (!info || !isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)) {
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
      <label className="flex flex-col gap-1.5">
        <span className="text-sm leading-none font-medium">{label}</span>
        {children}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </label>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-sm leading-none font-medium">
          {label}
        </label>
        <InfoTip label={info.label} title={info.title}>
          {info.body}
        </InfoTip>
      </div>
      {cloneElement(children, { id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  )
}
