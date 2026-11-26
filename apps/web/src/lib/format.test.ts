import { describe, expect, it } from 'vitest'

import {
  ago,
  clock,
  duration,
  durationFixed,
  estimate,
  offset,
  percent,
  sdPoints,
  tokensLong,
  tokensShort,
  usd,
} from './format'

describe('formats', () => {
  it('money in micros', () => {
    expect(usd(51_000)).toBe('$0.051')
    expect(usd(250_000, 2)).toBe('$0.25')
    expect(usd(5_449.8, 4)).toBe('$0.0054')
  })
  it('time', () => {
    expect(clock(232_000)).toBe('3m 52s')
    expect(clock(48_000)).toBe('0m 48s')
    expect(duration(9_800)).toBe('9.8 s')
    expect(duration(12_000)).toBe('12 s')
    expect(duration(63_000)).toBe('1m 03s')
    expect(durationFixed(22_000)).toBe('22.0 s')
    expect(offset(163_000)).toBe('+2m 43s')
    expect(offset(0)).toBe('+0.0 s')
  })
  it('tokens', () => {
    expect(tokensShort(31_200)).toBe('31.2k')
    expect(tokensShort(152_000)).toBe('152k')
    expect(tokensShort(788)).toBe('788')
    expect(tokensLong(4_612)).toBe('4,612')
  })
  it('relative time from a fixed now', () => {
    const now = new Date('2026-11-26T12:00:00Z')
    expect(ago('2026-11-26T11:58:00Z', now)).toBe('2 min ago')
    expect(ago('2026-11-26T11:00:00Z', now)).toBe('1 h ago')
    expect(ago('2026-11-25T11:00:00Z', now)).toBe('Yesterday')
    expect(ago('2026-11-23T11:00:00Z', now)).toBe('3 days ago')
    expect(ago('2026-11-26T11:59:40Z', now)).toBe('just now')
  })
  it('shares and estimates', () => {
    expect(percent(0.7667)).toBe('77%')
    expect(sdPoints(0.0577)).toBe('± 6')
    expect(estimate(0.04)).toBe('$0.04')
  })
})
