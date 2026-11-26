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

export const ORDER_STATUSES = ['pending', 'paid', 'partially_shipped', 'shipped', 'returned'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export interface ShipmentLine {
  sku: string
  quantity: number
}

export interface Shipment {
  id: string
  lines: ShipmentLine[]
  at: string
}

export type ReturnLine = ShipmentLine

export interface ReturnRecord {
  id: string
  lines: ReturnLine[]
  refundCents: number
  /** The restocking fee kept: 10% of the returned value from 14 days after the order, else 0. */
  feeCents: number
  at: string
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
  /** Units shipped so far, per SKU of the order. */
  shipped: Record<string, number>
  shipments: Shipment[]
  returns: ReturnRecord[]
  refundedCents: number
}
