// The model provider: the one door to a language model. The engine only knows this interface;
// the AI story plugs in the real client (Messages API, retries, model routing) and the price table.
// Tests use ScriptedProvider, which answers from a script and never calls an API.

import type { Agent } from './roles.js'

export interface TokenUsage {
  /** Input tokens not read from the cache. */
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export type ContentBlock =
  { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export interface Message {
  role: 'user' | 'assistant'
  content: string | (ContentBlock | ToolResultBlock)[]
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the input. */
  inputSchema: Record<string, unknown>
}

/** Who is calling: a role, the single agent, or the retro after the run. */
export type Caller = Agent | 'retro'

export interface ModelRequest {
  agent: Caller
  model: string
  system: string
  messages: Message[]
  tools: ToolSpec[]
  maxTokens: number
}

export interface ModelResponse {
  /** The model that answered (the provider may resolve an alias). */
  model: string
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | (string & {})
  usage: TokenUsage
  /** The provider's raw record, kept in the trace (trim large fields before returning it). */
  raw?: unknown
}

export interface ModelProvider {
  /** One model call. Throw when the call fails after the provider's own retries: the engine then tries the role's fallback model. */
  complete(request: ModelRequest): Promise<ModelResponse>
}

/** The cost of one call in micros (USD millionths). The AI story supplies the real price table. */
export type PriceFn = (model: string, usage: TokenUsage) => number

/** A price that is the same for every model, per million tokens (cache reads at a tenth of input). */
export function flatPrice(inputPerMillionUsd: number, outputPerMillionUsd: number): PriceFn {
  return (_model, u) =>
    Math.round(
      (u.inputTokens + u.cacheWriteTokens * 1.25) * inputPerMillionUsd +
        u.cacheReadTokens * inputPerMillionUsd * 0.1 +
        u.outputTokens * outputPerMillionUsd,
    )
}

/** What a scripted turn returns: the content blocks of the answer, or an error to throw. */
export type ScriptedTurn = ContentBlock[] | Error
export type Script = (request: ModelRequest, turn: number) => ScriptedTurn

/**
 * A provider that answers from a script, per agent, for tests and replays. The turn is the number of
 * answers already in the conversation, so every step starts at turn 0. Usage is estimated from the
 * text length, so budgets and costs behave like a real run without an API call.
 */
export class ScriptedProvider implements ModelProvider {
  readonly calls: ModelRequest[] = []

  constructor(private readonly scripts: Partial<Record<Caller, Script>>) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request)
    const script = this.scripts[request.agent]
    if (!script) throw new Error(`No script for the ${request.agent}.`)
    const turn = request.messages.filter((m) => m.role === 'assistant').length
    const answer = script(request, turn)
    if (answer instanceof Error) throw answer
    const inputChars = JSON.stringify([request.system, request.messages]).length
    const outputChars = JSON.stringify(answer).length
    return {
      model: request.model,
      content: answer,
      stopReason: answer.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: Math.ceil(outputChars / 4),
      },
      raw: { scripted: true, turn },
    }
  }
}

let toolUseCounter = 0
/** Helpers to write scripts: a tool call and a text answer. */
export const toolUse = (name: string, input: unknown): ContentBlock => ({
  type: 'tool_use',
  id: `toolu_${++toolUseCounter}`,
  name,
  input,
})
export const text = (value: string): ContentBlock => ({ type: 'text', text: value })
