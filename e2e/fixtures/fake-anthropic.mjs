// QA: a stand-in for the Messages API, loaded with `node --import` into the CLI, so the terminal gate
// can be tested with no key and no cost. It answers by the tools each agent is offered and logs every
// request (agent tools and the last user text) as JSON lines to FAKE_ANTHROPIC_LOG.
import { appendFileSync } from 'node:fs'

const API = 'https://api.anthropic.com/v1/messages'
const realFetch = globalThis.fetch
let n = 0

const PLAN = {
  steps: ['Add DELETE /orders/:id that cancels a pending order', 'Cover it with tests'],
  acceptance: ['A pending order becomes cancelled', 'A shipped order answers 409'],
  files: ['src/orders.ts'],
  estimateUsd: 0.02,
}

function lastUserText(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return last.content.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b.content ?? ''))).join('\n')
}

function answer(body) {
  const tools = (body.tools ?? []).map((t) => t.name)
  const toolUse = (name, input) => ({
    content: [{ type: 'tool_use', id: `toolu_fake_${++n}`, name, input }],
    stop_reason: 'tool_use',
  })
  if (tools.includes('submit_plan')) return toolUse('submit_plan', PLAN)
  if (tools.includes('submit_review')) return toolUse('submit_review', { verdict: 'approve', comments: [] })
  if (tools.includes('submit_lessons')) return toolUse('submit_lessons', { lessons: [] })
  return { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }
}

globalThis.fetch = async (url, init) => {
  if (String(url) !== API) return realFetch(url, init)
  const body = JSON.parse(init.body)
  const reply = answer(body)
  if (process.env.FAKE_ANTHROPIC_LOG)
    appendFileSync(
      process.env.FAKE_ANTHROPIC_LOG,
      JSON.stringify({
        model: body.model,
        tools: (body.tools ?? []).map((t) => t.name),
        user: lastUserText(body.messages),
        key: init.headers['x-api-key'],
      }) + '\n',
    )
  return new Response(
    JSON.stringify({
      id: `msg_fake_${n}`,
      model: body.model,
      ...reply,
      usage: { input_tokens: 1000, output_tokens: 100 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
