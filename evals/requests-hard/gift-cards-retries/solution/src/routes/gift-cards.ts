// Gift cards: bought with a balance, spent as a payment on orders.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'

export function giftCardRoutes(router: Router, { db }: Context): void {
  router.post('/gift-cards', async (req) => {
    const body = (await readJson(req)) as { amountCents?: unknown } | undefined
    const amount = body?.amountCents
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 500 || amount > 50000)
      return fail(400, 'amountCents must be a whole number from 500 to 50000')
    return json(await db.giftCards.create(amount), 201)
  })

  router.get('/gift-cards/:code', async (_req, { code }) => {
    const card = await db.giftCards.find(code as string)
    return card ? json(card) : fail(404, 'Gift card not found')
  })
}
