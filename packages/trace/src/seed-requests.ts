// A frozen copy of evals/requests/requests.json (id, title, request) and the hidden test count of each
// request. The seed test checks it against the source, so the two can't drift.

export interface SeedRequest {
  id: string
  title: string
  request: string
  hiddenTests: number
}

export const SEED_REQUESTS: SeedRequest[] = [
  {
    id: 'cancel-order',
    title: 'Add an order cancellation endpoint',
    request:
      'Add POST /orders/:id/cancel. A pending or paid order can be cancelled: answer 200 with the order, now with status "cancelled". A shipped order answers 409, an order that is already cancelled answers 409, and an unknown order answers 404. A cancelled order can\'t be paid or shipped (409). The daily total report (GET /reports/daily-total) leaves cancelled orders out.',
    hiddenTests: 6,
  },
  {
    id: 'paginate-orders',
    title: 'Paginate GET /orders',
    request:
      'GET /orders returns at most `limit` orders (default 20, from 1 to 100), oldest first, as { "items": [...], "nextCursor": ... }. nextCursor is the id of the first order of the next page, or null on the last page; the client passes it back as ?cursor=<id> to read the next page. A limit outside 1 to 100, a limit that isn\'t a whole number, or a cursor that isn\'t an order id answers 400.',
    hiddenTests: 5,
  },
  {
    id: 'validate-sku',
    title: 'Validate the SKU before adding to the cart',
    request:
      'POST /carts/:id/items must check the SKU against the catalog before the item enters the cart. An unknown SKU answers 404 with { "error": "Unknown SKU" } and leaves the cart as it was. If the quantity already in the cart plus the new quantity is more than the product\'s stock, answer 409 with { "error": "Not enough stock" } and leave the cart as it was. Known SKUs with enough stock work as before.',
    hiddenTests: 4,
  },
  {
    id: 'discount-codes',
    title: 'Apply discount codes at checkout',
    request:
      'POST /orders accepts an optional "code". FRESH10 takes 10% off the subtotal, rounded half up to the cent. FIVEOFF takes $5.00 off a subtotal of $25.00 or more; under that, answer 422 with { "error": "FIVEOFF needs a subtotal of $25.00" }. An unknown code answers 400 with { "error": "Unknown discount code" }. Codes are case-insensitive and stored in upper case. Every order shows "discountCode" (null without a code) and "discountCents" (0 without a code). With a code, the 8% tax is charged on the subtotal after the discount, rounded half up, and totalCents = subtotalCents - discountCents + taxCents. Orders without a code keep their current totals.',
    hiddenTests: 7,
  },
  {
    id: 'receipt-email',
    title: 'Add the customer email to the receipt',
    request:
      'The receipt (GET /orders/:id/receipt) shows the customer\'s email on its own line, right after the customer\'s name, as "Email: <address>". Every other line of the receipt stays exactly as it is.',
    hiddenTests: 3,
  },
  {
    id: 'rate-limit-orders',
    title: 'Rate-limit POST /orders',
    request:
      'Limit POST /orders to 5 orders per customer in any 60-second window, using the app\'s clock (createApp({ now })). An order counts while it is less than 60 seconds old. The 6th order in the window answers 429 with { "error": "Too many orders" } and a Retry-After header: the whole seconds, rounded up, until the oldest order in the window is 60 seconds old. Refused requests don\'t count, each customer has their own limit, and other routes are not limited.',
    hiddenTests: 6,
  },
  {
    id: 'export-csv',
    title: 'Export orders as CSV',
    request:
      'Add GET /orders.csv with Content-Type "text/csv; charset=utf-8". The first row is id,customer,status,created_at,subtotal,tax,total, then one row per order, oldest first. customer is the customer\'s name, created_at the order\'s createdAt as stored, and amounts are dollars with two decimals and no symbol (16.47). Quote a field that has a comma, a quote or a line break, doubling the quotes inside (RFC 4180). Every row ends with \\r\\n, including the last one; with no orders the file is only the header row.',
    hiddenTests: 5,
  },
  {
    id: 'fix-rounding',
    title: 'Fix rounding in order totals',
    request:
      "Some order totals are a cent off. The tax must be 8% of the order subtotal, rounded half up to the cent; today the code adds up the tax of each line instead. Fix it for new orders, so the order, the receipt and the daily total all use the corrected tax. Orders with one line don't change.",
    hiddenTests: 4,
  },
  {
    id: 'partial-refund',
    title: 'Refund part of an order',
    request:
      'Add POST /orders/:id/refunds with { "amountCents": <n> } to refund part of a paid or shipped order. Answer 201 with the order, which now has "refundedCents" (the sum of every refund) and "refunds": a list of { "amountCents", "at" } where at is the app clock\'s time as an ISO string. amountCents must be a whole number above 0 (else 400); refunds can\'t add up to more than totalCents (422 with { "error": "Refund exceeds the amount left" }); a pending order answers 409 and an unknown order 404. Orders that were never refunded show refundedCents 0 and refunds [].',
    hiddenTests: 6,
  },
  {
    id: 'search-orders',
    title: 'Search orders by customer',
    request:
      'GET /orders?customer=<text> returns only the orders whose customer name or email contains the text, ignoring case. Without the parameter, or with an empty one, it returns every order. The response keeps its shape, { "items": [...] }, oldest first.',
    hiddenTests: 5,
  },
]
