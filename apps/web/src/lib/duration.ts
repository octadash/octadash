/** "4 min", "2 hr 5 min", "3 days" in the reader's language. Never less than a minute. */
export function duration(locale: string, ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const unit = (value: number, u: 'minute' | 'hour' | 'day') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value)
  if (minutes < 60) return unit(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const rest = minutes % 60
    return rest > 0 ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}` : unit(hours, 'hour')
  }
  return unit(Math.round(hours / 24), 'day')
}
