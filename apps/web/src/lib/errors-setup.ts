import { type AreaSetup, type AreaSetupSource, areaSetup } from './area-setup'

/** Set up Errors: the code for each platform lives in @octadash/snippets, shared with the docs. */
export * from '@octadash/snippets/errors'

export type { AreaSetup as ErrorsSetup, AreaSetupState as ErrorsSetupState } from './area-setup'

/** Where a product stands on Errors: it sends once an issue was ever seen. */
export function errorsSetup(input: {
  sources: AreaSetupSource[]
  hadIssue: boolean
  dismissed: boolean
}): AreaSetup {
  return areaSetup('errors', { ...input, hadData: input.hadIssue })
}
