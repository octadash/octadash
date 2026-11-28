/** The octopus and the name, as on octadash.com. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="40 40 520 620" width="22" height="26" fill="none" aria-hidden="true">
        <path
          d="M55.17 381.63V287.96C55.17 271.2 68.68 257.6 85.34 257.6S115.52 271.2 115.52 287.96V437.14C115.52 453.9 129.03 467.5 145.69 467.5S175.86 453.9 175.86 437.14V183.88C175.86 114.9 231.44 58.98 300 58.98S424.14 114.9 424.14 183.88V437.14C424.14 453.9 437.65 467.5 454.31 467.5S484.48 453.9 484.48 437.14V287.96C484.48 271.2 497.99 257.6 514.66 257.6S544.83 271.2 544.83 287.96V381.63M237.93 381.63V565.51M300 381.63V631.43M362.07 381.63V565.51"
          stroke="var(--color-fd-primary)"
          strokeWidth="45"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="237.5" cy="286.5" r="22.5" fill="var(--color-fd-primary)" />
        <circle cx="361.5" cy="286.5" r="22.5" fill="var(--color-fd-primary)" />
      </svg>
      <span className="font-display text-lg font-semibold tracking-tight">Octadash</span>
      <span className="text-sm font-normal text-fd-muted-foreground">Docs</span>
    </span>
  )
}
