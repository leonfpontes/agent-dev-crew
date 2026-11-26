// An in-memory store with an async interface, so the routes read like they would against a real
// database. Every call returns copies: a caller can't change stored data by mutating a result.
import { CUSTOMERS, PRODUCTS } from './data.js'
import type { Cart, Customer, Order, Product } from './types.js'

const copy = <T>(value: T): T => structuredClone(value)

export interface Db {
  products: {
    list(): Promise<Product[]>
    find(sku: string): Promise<Product | undefined>
    update(sku: string, patch: Partial<Product>): Promise<Product>
  }
  customers: {
    find(id: string): Promise<Customer | undefined>
    update(id: string, patch: Partial<Customer>): Promise<Customer>
  }
  carts: {
    create(customerId: string): Promise<Cart>
    find(id: string): Promise<Cart | undefined>
    update(id: string, patch: Partial<Cart>): Promise<Cart>
  }
  orders: {
    list(): Promise<Order[]>
    find(id: string): Promise<Order | undefined>
    insert(order: Omit<Order, 'id'>): Promise<Order>
    update(id: string, patch: Partial<Order>): Promise<Order>
  }
}

export interface DbSeed {
  products?: Product[]
  customers?: Customer[]
  orders?: Order[]
}

export function createDb(seed: DbSeed = {}): Db {
  const products = new Map((seed.products ?? PRODUCTS).map((p) => [p.sku, copy(p)]))
  const customers = new Map(
    (seed.customers ?? CUSTOMERS).map((c) => [c.id, { points: 0, lifetimePoints: 0, ...copy(c) }]),
  )
  const carts = new Map<string, Cart>()
  const orders = new Map((seed.orders ?? []).map((o) => [o.id, copy(o)]))
  let nextCart = 1
  let nextOrder = orders.size + 1

  const patchOf =
    <T extends object>(store: Map<string, T>, kind: string) =>
    async (id: string, patch: Partial<T>) => {
      const current = store.get(id)
      if (!current) throw new Error(`No ${kind} "${id}".`)
      const next = { ...current, ...copy(patch) }
      store.set(id, next)
      return copy(next)
    }

  return {
    products: {
      list: async () => [...products.values()].map(copy),
      find: async (sku) => copy(products.get(sku)),
      update: patchOf(products, 'product'),
    },
    customers: {
      find: async (id) => copy(customers.get(id)),
      update: patchOf(customers, 'customer'),
    },
    carts: {
      create: async (customerId) => {
        const cart: Cart = { id: `cart_${String(nextCart++).padStart(4, '0')}`, customerId, lines: [] }
        carts.set(cart.id, cart)
        return copy(cart)
      },
      find: async (id) => copy(carts.get(id)),
      update: patchOf(carts, 'cart'),
    },
    orders: {
      list: async () => [...orders.values()].map(copy),
      find: async (id) => copy(orders.get(id)),
      insert: async (order) => {
        const saved: Order = { id: `ord_${String(nextOrder++).padStart(4, '0')}`, ...copy(order) }
        orders.set(saved.id, saved)
        return copy(saved)
      },
      update: patchOf(orders, 'order'),
    },
  }
}
