import { describe, expect, it } from 'vitest'
import { pageFields, parseUserAgent, requestContext } from './context'

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      { browser: 'Edge', os: 'Windows', device: 'desktop', isBot: false },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { browser: 'Chrome', os: 'macOS', device: 'desktop', isBot: false },
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      { browser: 'Samsung Internet', os: 'Android', device: 'mobile', isBot: false },
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
      { browser: 'Chrome', os: 'iOS', device: 'tablet', isBot: false },
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
      { browser: 'Firefox', os: 'Linux', device: 'desktop', isBot: false },
    ],
    [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      { browser: '', os: '', device: 'desktop', isBot: true },
    ],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)', { isBot: true }],
  ])('%s', (ua, expected) => {
    expect(parseUserAgent(ua)).toMatchObject(expected)
  })
})

describe('requestContext', () => {
  it('takes the first forwarded address and a proxy country', () => {
    const headers: Record<string, string> = {
      'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1',
      'cloudfront-viewer-country': 'pt',
      'user-agent': 'UA',
    }
    expect(requestContext((name) => headers[name])).toEqual({
      ip: '203.0.113.7',
      userAgent: 'UA',
      country: 'PT',
    })
    expect(requestContext((name) => ({ 'cf-ipcountry': 'XX' })[name]).country).toBe('')
  })
})

describe('pageFields', () => {
  it('ignores a referrer on the same site and bad addresses', () => {
    expect(
      pageFields({
        $current_url: 'https://app.example.com/a?b=1',
        $referrer: 'https://app.example.com/login',
      }),
    ).toMatchObject({ path: '/a', host: 'app.example.com', referrer_host: '' })
    expect(pageFields({ $current_url: 'not a url' }).path).toBe('')
    expect(pageFields(undefined).host).toBe('')
  })
})
