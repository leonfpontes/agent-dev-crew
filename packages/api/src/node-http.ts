// Serves the API (and, for the demo, the built app) on Node's http module. Listens on 127.0.0.1
// only. Unknown app routes get index.html, so links like /runs/142 open the app.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

import { MAX_BODY_BYTES } from './routes.js'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function readBody(req: IncomingMessage): Promise<Buffer | 'too-large'> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) return 'too-large'
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function send(res: ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}

/** A file of the built app inside `staticDir` (never outside it), or its index.html. */
function staticFile(staticDir: string, pathname: string): string | undefined {
  const file = path.resolve(staticDir, `.${decodeURIComponent(pathname)}`)
  if (!file.startsWith(path.resolve(staticDir) + path.sep) && file !== path.resolve(staticDir))
    return undefined
  if (existsSync(file) && statSync(file).isFile()) return file
  const index = path.join(staticDir, 'index.html')
  return existsSync(index) ? index : undefined
}

export function serveHttp(
  handler: (request: Request) => Promise<Response>,
  { host = '127.0.0.1', port = 8787, staticDir }: { host?: string; port?: number; staticDir?: string } = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`)
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
        const file = staticDir ? staticFile(staticDir, url.pathname) : undefined
        if (!file)
          return send(
            res,
            new Response('Not found. Build the app (pnpm build) or use /api.', { status: 404 }),
          )
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
        return void createReadStream(file).pipe(res)
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
      if (body === 'too-large')
        return send(
          res,
          new Response(JSON.stringify({ error: `The body is over ${MAX_BODY_BYTES} bytes.` }), {
            status: 413,
          }),
        )
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
      await send(res, await handler(new Request(url, { method: req.method, headers, body })))
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `The server failed: ${(e as Error).message}` }))
    }
  }).listen(port, host)
}
