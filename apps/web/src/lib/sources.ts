/** Where a source runs. The Traffic platforms come first; the install code follows it. */
export const SOURCE_PLATFORMS = [
  'html',
  'nextjs',
  'react',
  'wordpress',
  'gtm',
  'node',
  'python',
  'dotnet',
  'java',
  'go',
  'php',
  'ruby',
  'mobile',
  'other',
] as const
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number]

export function isSourcePlatform(value: string): value is SourcePlatform {
  return (SOURCE_PLATFORMS as readonly string[]).includes(value)
}

/** How long the old key keeps working after a rotation. */
export const ROTATE_OVERLAPS = { now: 0, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }
export type RotateOverlap = keyof typeof ROTATE_OVERLAPS

export function isRotateOverlap(value: string): value is RotateOverlap {
  return Object.hasOwn(ROTATE_OVERLAPS, value)
}
