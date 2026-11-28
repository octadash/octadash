import { Callout } from 'fumadocs-ui/components/callout'

/** Shown above an English page served under /pt. */
export function Untranslated() {
  return (
    <Callout type="info" className="mt-6">
      Esta página ainda não foi traduzida. O texto abaixo está em inglês.
    </Callout>
  )
}
