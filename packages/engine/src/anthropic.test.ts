// The real provider against a fake fetch: the request it sends, the response it returns, the
// retries and the fallback. Nothing here reaches the network.
import { getRun, stepEvents } from '@crew/trace'
import { rmSync } from 'node:fs'

import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  anthropicPrice,
  ApiError,
  createAnthropicProvider,
  DEFAULT_ALLOWED_MODELS,
  PRICES,
  ratesFor,
  retryDelay,
  runCrew,
  scriptedGate,
  type ModelRequest,
  type TokenUsage,
} from './index.js'
import { EXAMPLE, freshTrace, PLAN, REQUEST, testRoles, workRoot } from './test/fixtures.js'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fail = (status: number, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    {
      status,
      headers,
    },
  )

const reply = (model: string, content: unknown[] = [{ type: 'text', text: 'Hi.' }], stop = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model,
  content,
  stop_reason: stop,
  usage: {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: null,
  },
})

const REQ: ModelRequest = {
  agent: 'engineer',
  model: 'claude-haiku-5-5',
  system: 'You are the engineer.',
  messages: [
    { role: 'user', content: 'Add the route.' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/a.ts' } }],
    },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'toolu_1', content: '"x"', isError: true }] },
  ],
  tools: [{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } }],
  maxTokens: 1000,
}

function provider(responses: (Response | Error)[], extra: { maxRetries?: number } = {}) {
  const fetch = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  const sleep = vi.fn(async () => {})
  return { fetch, sleep, p: createAnthropicProvider({ apiKey: 'test-key', fetch, sleep, ...extra }) }
}

describe('createAnthropicProvider', () => {
  it('sends a Messages API request: tools, tool results, effort, caching and the headers', async () => {
    const { fetch, p } = provider([ok(reply('claude-haiku-5-5'))])
    await p.complete(REQ)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      system: 'You are the engineer.',
      messages: [
        { role: 'user', content: 'Add the route.' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/a.ts' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '"x"', is_error: true }],
        },
      ],
      tools: [{ name: 'read_file', description: 'Read a file.', input_schema: { type: 'object' } }],
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
    })
  })

  it('sends no effort to a model that has no setting, and no tools when there are none', async () => {
    const { fetch, p } = provider([ok(reply('claude-haiku-4-5-20251001'))])
    await p.complete({ ...REQ, model: 'claude-haiku-4-5-20251001', tools: [] })
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).not.toHaveProperty('output_config')
    expect(body).not.toHaveProperty('tools')
  })

  it('returns the content, the stop reason, the usage with cache tokens, and a trimmed raw record', async () => {
    const content = [
      { type: 'text', text: 'Reading.' },
      { type: 'tool_use', id: 'toolu_9', name: 'read_file', input: { path: 'src/b.ts' } },
    ]
    const { p } = provider([ok(reply('claude-haiku-5-5', content, 'tool_use'))])
    const response = await p.complete(REQ)
    expect(response).toEqual({
      model: 'claude-haiku-5-5',
      content,
      stopReason: 'tool_use',
      usage: { inputTokens: 120, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 30 },
      raw: {
        id: 'msg_1',
        model: 'claude-haiku-5-5',
        stop_reason: 'tool_use',
        usage: expect.objectContaining({ input_tokens: 120 }),
      },
    })
  })

  it('retries overloads, rate limits and network errors, honouring retry-after', async () => {
    const { fetch, sleep, p } = provider([
      fail(529),
      fail(429, { 'retry-after': '7' }),
      new TypeError('fetch failed'),
      ok(reply('claude-haiku-5-5')),
    ])
    const response = await p.complete(REQ)
    expect(response.model).toBe('claude-haiku-5-5')
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls[1]).toEqual([7000])
  })

  it('throws after the last retry, so the engine can move to the fallback', async () => {
    const { fetch, p } = provider([fail(529), fail(529), fail(529)], { maxRetries: 2 })
    await expect(p.complete(REQ)).rejects.toThrow('529 overloaded_error: Overloaded (after 3 attempts)')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry a request the API refuses, or one the server says not to retry', async () => {
    const bad = provider([fail(400), ok(reply('claude-haiku-5-5'))])
    const error = await bad.p.complete(REQ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, retryable: false })
    expect(bad.fetch).toHaveBeenCalledTimes(1)

    const told = provider([fail(503, { 'x-should-retry': 'false' })])
    await expect(told.p.complete(REQ)).rejects.toMatchObject({ status: 503 })
    expect(told.fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a model outside the cost allowlist and a missing key before any call', async () => {
    const { fetch, p } = provider([ok(reply('x'))])
    await expect(p.complete({ ...REQ, model: 'claude-opus-5-5' })).rejects.toThrow(
      'not in the allowed models',
    )
    const custom = createAnthropicProvider({ apiKey: 'k', fetch, allowedModels: ['claude-haiku-5-5'] })
    await expect(custom.complete({ ...REQ, model: 'claude-haiku-4-5-20251001' })).rejects.toThrow(
      'not in the allowed models (claude-haiku-5-5)',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(() => createAnthropicProvider({ apiKey: '' })).toThrow('ANTHROPIC_API_KEY is missing')
  })

  it('waits exponentially with jitter, capped at 30 s', () => {
    expect(retryDelay(0, null, () => 0)).toBe(500)
    expect(retryDelay(2, null, () => 1)).toBe(4000)
    expect(retryDelay(10, null, () => 1)).toBe(30_000)
    expect(retryDelay(0, '120')).toBe(30_000)
    expect(retryDelay(0, 'soon', () => 0)).toBe(500)
  })
})

describe('anthropicPrice', () => {
  const usage = (u: Partial<TokenUsage>): TokenUsage => ({
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...u,
  })

  it('prices Claude Haiku 5.5 per token type, in micros', () => {
    // 10k input × $0.10 + 20k cache write × $0.125 + 50k cache read × $0.01 + 2k output × $0.50
    expect(
      anthropicPrice(
        'claude-haiku-5-5',
        usage({
          inputTokens: 10_000,
          cacheWriteTokens: 20_000,
          cacheReadTokens: 50_000,
          outputTokens: 2_000,
        }),
      ),
    ).toBe(1000 + 2500 + 500 + 1000)
  })

  it('moves a Haiku 5.5 request over 100k prompt tokens (cache included) to the long-prompt tier', () => {
    expect(ratesFor('claude-haiku-5-5', usage({ inputTokens: 100_000 })).input).toBe(0.1)
    const over = usage({ inputTokens: 1, cacheReadTokens: 100_000, outputTokens: 1_000 })
    expect(ratesFor('claude-haiku-5-5', over).input).toBe(0.5)
    expect(anthropicPrice('claude-haiku-5-5', over)).toBe(Math.round(0.5 + 100_000 * 0.05 + 1_000 * 2.5))
  })

  it('prices the fallback model, and refuses a model with no price', () => {
    expect(
      anthropicPrice('claude-haiku-4-5-20251001', usage({ inputTokens: 1_000, outputTokens: 1_000 })),
    ).toBe(6_000)
    expect(() => anthropicPrice('claude-unknown', usage({}))).toThrow(
      'No price for the model "claude-unknown"',
    )
    expect(DEFAULT_ALLOWED_MODELS).toEqual(Object.keys(PRICES))
  })
})

describe('fallback through the engine', () => {
  const root = workRoot()
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('moves the step to the fallback model when the primary hits the rate limit, and records it', async () => {
    const plan = { type: 'tool_use', id: 'toolu_p', name: 'submit_plan', input: PLAN }
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      return body.model === 'claude-haiku-5-5'
        ? fail(429, { 'retry-after': '0' })
        : ok(reply(body.model, [plan], 'tool_use'))
    })
    const trace = freshTrace()
    const result = await runCrew({
      trace,
      provider: createAnthropicProvider({ apiKey: 'test-key', fetch, sleep: async () => {}, maxRetries: 1 }),
      price: anthropicPrice,
      roles: testRoles({
        po: { models: { primary: 'claude-haiku-5-5', fallback: 'claude-haiku-4-5-20251001' } },
      }),
      gate: scriptedGate([{ decision: 'reject', by: 'person', comment: 'Stop here.' }]),
      request: REQUEST,
      variant: 'crew',
      origin: 'live',
      exampleDir: EXAMPLE,
      workRoot: root,
    })
    expect(result.status).toBe('rejected')
    expect(fetch).toHaveBeenCalledTimes(3) // primary + 1 retry, then the fallback
    const plan0 = getRun(trace, result.runId)!.steps[0]!
    expect(plan0).toMatchObject({ model: 'claude-haiku-4-5-20251001', fallback_used: 1, attempt: 2 })
    const warn = stepEvents(trace, plan0.id).find((e) => e.kind === 'log')
    expect(String((warn?.payload as { message: string }).message)).toContain(
      'claude-haiku-5-5 failed (429 overloaded_error: Overloaded (after 2 attempts)); retrying with claude-haiku-4-5-20251001',
    )
    const cost = trace.prepare('SELECT model, cost_micros FROM costs WHERE run_id = ?').get(result.runId) as {
      model: string
      cost_micros: number
    }
    expect(cost).toEqual({
      model: 'claude-haiku-4-5-20251001',
      cost_micros: Math.round(120 + 900 * 0.1 + 30 * 5),
    })
  })
})
