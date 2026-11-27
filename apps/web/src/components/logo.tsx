export function Logo({ size = 28 }: { size?: number }) {
  // biome-ignore lint/performance/noImgElement: static SVG, no optimization needed
  return <img src="/logo-magenta.svg" alt="" width={size} height={Math.round(size * 1.13)} />
}
