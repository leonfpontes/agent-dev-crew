// The README's scoreboard is written from evals/results/*.json, never by hand. This fails when the
// README falls behind a scoreboard; `pnpm readme` (UPDATE_README=1) rewrites the block.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'
import { describe, expect, it } from 'vitest'

import {
  END,
  modelName,
  readScoreboard,
  scoreboardBlock,
  START,
  withScoreboard,
} from './readme-scoreboard.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = path.join(root, 'evals/results')
const boards = readdirSync(results)
  .filter((f) => f.endsWith('.json'))
  .map((f) => readScoreboard(`evals/results/${f}`, JSON.parse(readFileSync(path.join(results, f), 'utf8'))))

async function expected(readme: string) {
  const options = { ...(await resolveConfig(path.join(root, 'README.md'))), parser: 'markdown' }
  return format(withScoreboard(readme, scoreboardBlock(boards)), options)
}

describe('README scoreboard', () => {
  it('has a block for every scoreboard in evals/results', () => {
    expect(boards.length).toBeGreaterThan(0)
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
    expect(readme).toContain(START)
    expect(readme).toContain(END)
  })

  it('is up to date with the scoreboards (pnpm readme when this fails)', async () => {
    const file = path.join(root, 'README.md')
    const readme = readFileSync(file, 'utf8')
    const fresh = await expected(readme)
    if (process.env.UPDATE_README) writeFileSync(file, fresh)
    else expect(readme).toBe(fresh)
  })

  it('names models as people read them', () => {
    expect(modelName('claude-haiku-5-5')).toBe('Claude Haiku 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5 20251001')
  })
})
