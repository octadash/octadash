import { describe, expect, it } from 'vitest'
import { aiCostMicros, aiPrice } from './ai-prices'

describe('aiPrice', () => {
  it('finds models as apps name them', () => {
    expect(aiPrice('gpt-4o')?.model).toBe('gpt-4o')
    expect(aiPrice('openai/gpt-4o')?.model).toBe('gpt-4o')
    expect(aiPrice('GPT-4o-mini-2099-01-01')?.model).toBe('gpt-4o-mini')
    expect(aiPrice('claude-sonnet-4-5-20990101')?.model).toBe('claude-sonnet-4-5')
    expect(aiPrice('models/gemini-2.5-pro')?.model).toBe('gemini-2.5-pro')
    expect(aiPrice('my-own-model')).toBeNull()
    expect(aiPrice('')).toBeNull()
  })
})

describe('aiCostMicros', () => {
  it('prices cached input apart from the rest', () => {
    const price = {
      model: 'm',
      provider: 'p',
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    }
    // 1000 input of which 400 read and 100 written: 500 × 3 + 400 × 0.3 + 100 × 3.75 + 200 × 15.
    expect(aiCostMicros({ input: 1000, output: 200, cacheRead: 400, cacheWrite: 100 }, price)).toBe(
      1500 + 120 + 375 + 3000,
    )
  })
})
