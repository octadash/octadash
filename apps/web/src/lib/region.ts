/**
 * Currency and time zone choices for an organization: the lists the runtime
 * knows, written for people, and a first guess from the browser.
 */

export interface Choice {
  value: string
  label: string
}

/** "BRL · Brazilian real", for every currency the runtime can format. */
export function currencyChoices(locale: string): Choice[] {
  const names = new Intl.DisplayNames(locale, { type: 'currency' })
  return Intl.supportedValuesOf('currency').map((code) => ({
    value: code,
    label: `${code} · ${names.of(code) ?? code}`,
  }))
}

/** "UTC−3", "UTC+5:30", "UTC" for a zone at a given moment. */
export function utcOffset(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value
  const offset = (part ?? 'GMT').replace(/^GMT/, '').replace(/^[+-]0$/, '')
  return offset ? `UTC${offset.replace('-', '−')}` : 'UTC'
}

/** Time zones by region ("America", "Europe"), each as "São Paulo (UTC−3)". */
export function timeZoneGroups(at: Date): { region: string; zones: Choice[] }[] {
  const groups = new Map<string, Choice[]>()
  const zones = Intl.supportedValuesOf('timeZone')
  for (const zone of zones.includes('UTC') ? zones : ['UTC', ...zones]) {
    const parts = zone.split('/')
    const region = parts.length > 1 ? (parts[0] ?? '') : ''
    const place = (parts.slice(1).join(' / ') || zone).replaceAll('_', ' ')
    const list = groups.get(region) ?? []
    list.push({ value: zone, label: region ? `${place} (${utcOffset(zone, at)})` : zone })
    groups.set(region, list)
  }
  return [...groups]
    .map(([region, list]) => ({
      region,
      zones: list.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.region.localeCompare(b.region))
}

/** The euro area, which shares one code. */
const EURO = [
  'AT',
  'BE',
  'BG',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
  'AD',
  'MC',
  'SM',
  'VA',
  'ME',
  'XK',
]

/** The currency of a country, for the countries people most often run products from. */
const CURRENCY_OF: Record<string, string> = {
  ...Object.fromEntries(EURO.map((region) => [region, 'EUR'])),
  AE: 'AED',
  AR: 'ARS',
  AU: 'AUD',
  BO: 'BOB',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  CL: 'CLP',
  CN: 'CNY',
  CO: 'COP',
  CR: 'CRC',
  CZ: 'CZK',
  DK: 'DKK',
  DO: 'DOP',
  EG: 'EGP',
  GB: 'GBP',
  GT: 'GTQ',
  HK: 'HKD',
  HU: 'HUF',
  ID: 'IDR',
  IL: 'ILS',
  IN: 'INR',
  IS: 'ISK',
  JP: 'JPY',
  KE: 'KES',
  KR: 'KRW',
  MA: 'MAD',
  MX: 'MXN',
  MY: 'MYR',
  NG: 'NGN',
  NO: 'NOK',
  NZ: 'NZD',
  PE: 'PEN',
  PH: 'PHP',
  PK: 'PKR',
  PL: 'PLN',
  PY: 'PYG',
  RO: 'RON',
  RS: 'RSD',
  SA: 'SAR',
  SE: 'SEK',
  SG: 'SGD',
  TH: 'THB',
  TR: 'TRY',
  TW: 'TWD',
  UA: 'UAH',
  US: 'USD',
  UY: 'UYU',
  VN: 'VND',
  ZA: 'ZAR',
}

/** A guess from a language tag ("pt-BR" → "BRL"); USD when the country is unknown. */
export function currencyOfLocale(tag: string): string {
  try {
    const region = new Intl.Locale(tag).maximize().region
    return (region && CURRENCY_OF[region]) || 'USD'
  } catch {
    return 'USD'
  }
}
