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

export interface GiftCard {
  code: string
  balanceCents: number
}

export interface Order {
  id: string
  customerId: string
  lines: Line[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  status: OrderStatus
  createdAt: string
  /** The gift card that paid part of the order (upper case), or null. */
  giftCard: string | null
  giftCardCents: number
  amountDueCents: number
}
