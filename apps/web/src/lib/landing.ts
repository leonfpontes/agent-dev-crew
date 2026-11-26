// Facts the How it works page states about the engine. The app can't import the engine (it runs
// in Node), so they live here, and tests/landing-facts.test.ts compares them with the engine's own
// constants (AGENT_TOOLS, MODELS, DEFAULT_BUDGET_MICROS, MAX_FIX_LOOPS).

export const REPOSITORY = 'https://github.com/leonfpontes/agent-dev-crew'
export const ATLAS_REPOSITORY = 'https://github.com/leonfpontes/atlas-ds-mcp'
export const LINKEDIN = 'https://www.linkedin.com/in/leonardo-fonseca-pontes-465740103/'
export const GITHUB_PROFILE = 'https://github.com/leonfpontes'

export const MODELS = { primary: 'claude-haiku-5-5', fallback: 'claude-haiku-4-5-20251001' } as const
export const BUDGET_MICROS = 250_000
export const MAX_FIX_LOOPS = 2

export const ROLES: {
  role: string
  agent: 'po' | 'engineer' | 'reviewer' | 'qa'
  does: string
  tools: string[]
}[] = [
  {
    role: 'PO',
    agent: 'po',
    does: 'Turns the request into a plan and testable acceptance criteria',
    tools: ['list_files', 'read_file', 'submit_plan'],
  },
  {
    role: 'Engineer',
    agent: 'engineer',
    does: 'Changes the code on a throwaway copy of the repository',
    tools: ['list_files', 'read_file', 'write_file', 'run_tests'],
  },
  {
    role: 'Reviewer',
    agent: 'reviewer',
    does: 'Blocks on a missing error path, an untested branch or a change outside the plan',
    tools: ['list_files', 'read_file', 'submit_review'],
  },
  {
    role: 'QA',
    agent: 'qa',
    does: 'Writes tests for the acceptance criteria, runs the full suite and names the failing test',
    tools: ['list_files', 'read_file', 'write_file', 'run_tests'],
  },
]

export const CLONE = `$ git clone ${REPOSITORY}\n$ cd agent-dev-crew && pnpm install`
