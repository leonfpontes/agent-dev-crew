import { describe, expect, it } from 'vitest'

import { client } from './helpers.js'

describe('daily total', () => {
  it('adds up the orders of the day', async () => {
    const api = client()
    await api.order('cus_ada', [['APL-GALA-1KG', 2]]) // 900 + 72 tax
    await api.order('cus_ben', [['BRD-SOUR-800', 1]]) // 625 + 50 tax
    expect((await api.get('/reports/daily-total?date=2026-11-20')).body).toEqual({
      date: '2026-11-20',
      totalCents: 1647,
    })
  })

  it('leaves out orders of other days', async () => {
    const api = client()
    await api.order('cus_ada', [['APL-GALA-1KG', 1]])
    api.setNow(new Date('2026-11-21T08:30:00Z'))
    await api.order('cus_ada', [['BRD-SOUR-800', 1]])
    expect((await api.get('/reports/daily-total?date=2026-11-21')).body.totalCents).toBe(675)
  })

  it('answers 400 for a date that is not YYYY-MM-DD', async () => {
    expect((await client().get('/reports/daily-total?date=20/11/2026')).status).toBe(400)
  })
})
