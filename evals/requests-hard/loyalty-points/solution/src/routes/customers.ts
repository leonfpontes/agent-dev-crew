// Customers, with their loyalty points.
import type { Context } from '../context.js'
import { fail, json, type Router } from '../http.js'

export function customerRoutes(router: Router, { db }: Context): void {
  router.get('/customers/:id', async (_req, { id }) => {
    const customer = await db.customers.find(id as string)
    if (!customer) return fail(404, 'Customer not found')
    return json({ id: customer.id, name: customer.name, email: customer.email, points: customer.points ?? 0 })
  })
}
