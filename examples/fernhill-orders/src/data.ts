// Made-up catalog and customers of Fernhill Market, a store that doesn't exist.
import type { Customer, Product } from './types.js'

export const PRODUCTS: Product[] = [
  { sku: 'APL-GALA-1KG', name: 'Gala apples, 1 kg', unitCents: 450, stock: 40 },
  { sku: 'BRD-SOUR-800', name: 'Sourdough loaf, 800 g', unitCents: 625, stock: 12 },
  { sku: 'EGG-FREE-12', name: 'Free-range eggs, 12', unitCents: 599, stock: 30 },
  { sku: 'MLK-OAT-1L', name: 'Oat milk, 1 l', unitCents: 349, stock: 24 },
  { sku: 'CHS-CHED-200', name: 'Aged cheddar, 200 g', unitCents: 1031, stock: 8 },
  { sku: 'COF-BEAN-500', name: 'Coffee beans, 500 g', unitCents: 1499, stock: 15 },
  { sku: 'HNY-WILD-350', name: 'Wildflower honey, 350 g', unitCents: 875, stock: 0 },
  { sku: 'TOM-HEIR-500', name: 'Heirloom tomatoes, 500 g', unitCents: 520, stock: 20 },
]

export const CUSTOMERS: Customer[] = [
  { id: 'cus_ada', name: 'Ada Brightwater', email: 'ada@example.com' },
  { id: 'cus_ben', name: 'Ben Okafor', email: 'ben.okafor@example.com' },
  { id: 'cus_cleo', name: 'Cleo Marsh', email: 'cleo@example.org' },
]
