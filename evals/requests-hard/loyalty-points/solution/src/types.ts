// The shapes the store keeps. Amounts are whole cents; dates are ISO 8601 strings in UTC.

export interface Product {
  sku: string
  name: string
  unitCents: number
  stock: number
}

export interface Customer {
  id: string
  name: string
  email: string
  /** Loyalty points: 1 per whole dollar paid before tax; 100 points are worth $1.00. */
  points?: number
}

export interface Line {
  sku: string
  name: string
  unitCents: number
  quantity: number
  lineCents: number
}

export interface Cart {
  id: string
  customerId: string
  lines: Line[]
}

export const ORDER_STATUSES = ['pending', 'paid', 'shipped'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export interface Order {
  id: string
  customerId: string
  lines: Line[]
  subtotalCents: number
  pointsRedeemed: number
  discountCents: number
  taxCents: number
  totalCents: number
  status: OrderStatus
  createdAt: string
}
