// A small router over the Fetch API's Request and Response, so the app runs in Node, in a test
// or behind any server without a framework.

export type Params = Record<string, string>
export type Handler = (req: Request, params: Params, url: URL) => Response | Promise<Response>

interface Route {
  method: string
  parts: string[]
  handler: Handler
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

/** An error answer: `{ "error": message }`. */
export function fail(status: number, error: string, headers: Record<string, string> = {}): Response {
  return json({ error }, status, headers)
}

/** The JSON body of a request, or undefined when it isn't valid JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}

export class Router {
  private routes: Route[] = []

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler })
    return this
  }

  get(path: string, handler: Handler): this {
    return this.on('GET', path, handler)
  }

  post(path: string, handler: Handler): this {
    return this.on('POST', path, handler)
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    let pathMatched = false
    for (const route of this.routes) {
      const params = match(route.parts, parts)
      if (!params) continue
      pathMatched = true
      if (route.method === req.method) return route.handler(req, params, url)
    }
    return pathMatched ? fail(405, 'Method not allowed') : fail(404, 'Not found')
  }
}

function match(pattern: string[], parts: string[]): Params | undefined {
  if (pattern.length !== parts.length) return undefined
  const params: Params = {}
  for (const [i, p] of pattern.entries()) {
    const part = parts[i] as string
    if (p.startsWith(':')) params[p.slice(1)] = part
    else if (p !== part) return undefined
  }
  return params
}
