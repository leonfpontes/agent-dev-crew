// Repository guards: the team skeleton is in place, nothing internal reaches a repository that is
// public from its first commit, and tests only read files that ship with it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

/** Tracked files plus new files not ignored by git: what a commit would carry. */
function repoFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
  return out.split('\0').filter((f) => f && existsSync(path.join(root, f)))
}

// Names of private projects, clients and the internal team that must never appear here. They are
// stored encoded so that this file passes its own check: the guard has no exceptions.
const BANNED = [
  'b3BlbmJvdA==',
  'dGltZSBkZXY=',
  'bmljayBmdXJ5',
  'dmVzcGE=',
  'YmF0bWFu',
  'aG9tZW0tYXJhbmhh',
  'ZGVtb2xpZG9y',
  'dG9ueSBzdGFyaw==',
  'b3JbYcOhXWN1bG8=',
  'cHJvZmVzc29yIHg=',
  'YmFyW2HDo11v',
  'YXRyYQ==',
  'dGVycmVpcm8=',
  'Z2lyYWh1Yg==',
  'c29maXNh',
].map((b64) => new RegExp(`\\b${Buffer.from(b64, 'base64').toString('utf8')}\\b`, 'iu'))

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|webm|pdf|zip|sqlite|db)$/i

describe('team skeleton', () => {
  it.each([
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'LICENSE',
    '.editorconfig',
    '.gitignore',
    '.env.example',
    '.nvmrc',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    '.github/workflows/security.yml',
    '.github/dependabot.yml',
    'docs/README.md',
    'docs/ARCHITECTURE.md',
    'docs/adr/0001-pnpm-typescript-atlas.md',
    'docs/adr/0002-packages-node-and-storage.md',
  ])('has %s', (file) => {
    expect(existsSync(path.join(root, file))).toBe(true)
  })

  it('is MIT licensed, with the security contact', () => {
    expect(read('LICENSE')).toMatch(/^MIT License/)
    expect(JSON.parse(read('package.json')).license).toBe('MIT')
    expect(read('SECURITY.md')).toContain('contato@leopontes.com.br')
  })

  it('keeps Claude Code away from secrets and typechecks on stop', () => {
    const settings = JSON.parse(read('.claude/settings.json'))
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Read(./.env)', 'Read(./.env.local)']))
    const hook = settings.hooks.Stop[0].hooks[0].command as string
    const script = hook.replace('"$CLAUDE_PROJECT_DIR"', root)
    expect(read(path.relative(root, script))).toContain('typecheck')
    expect(statSync(script).mode & 0o111).not.toBe(0)
  })

  it('runs gitleaks on pull requests, with the permission it needs', () => {
    const security = read('.github/workflows/security.yml')
    expect(security).toContain('gitleaks/gitleaks-action')
    expect(security).toContain('pull-requests: read')
  })

  it('never commits real environment files', () => {
    const files = repoFiles()
    expect(files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'))).toEqual([])
    expect(read('.env.example')).not.toMatch(/^[A-Z0-9_]+=\S/m)
  })
})

describe('monorepo', () => {
  // ADR 0002: every workspace package is private; the demo runs from a clone.
  it.each([
    ['packages/core', '@crew/core'],
    ['packages/sandbox', '@crew/sandbox'],
    ['packages/trace', '@crew/trace'],
    ['apps/web', '@crew/web'],
    ['examples/fernhill-orders', 'fernhill-orders'],
    ['evals', '@crew/evals'],
  ])('%s is the private package %s with its own build', (dir, name) => {
    const pkg = JSON.parse(read(`${dir}/package.json`))
    expect(pkg.name).toBe(name)
    expect(pkg.private).toBe(true)
    expect(pkg.scripts.build).toBeTruthy()
  })

  it('runs the end-to-end tests on their own port, never on a server already running', () => {
    const config = read('playwright.config.ts')
    expect(config).toContain('process.env.E2E_PORT')
    expect(config).toContain('reuseExistingServer: false')
    expect(config).toContain('--strictPort')
  })

  it('uses the published Atlas components in the app', () => {
    const web = JSON.parse(read('apps/web/package.json'))
    expect(web.dependencies['@leonfpontes/atlas-ui']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('public repository', () => {
  it('names no private project, client or internal team, with no exceptions', () => {
    const hits: string[] = []
    for (const file of repoFiles()) {
      if (BINARY.test(file)) continue
      const text = read(file)
      for (const word of BANNED) if (word.test(text)) hits.push(`${file}: ${word.source}`)
    }
    expect(hits).toEqual([])
  })

  it('has tests that read only files inside the repository', () => {
    const outside = /(\/Users\/|\/home\/|~\/Documents|_planos|\.\.\/\.\.\/\.\.\/)/
    const tests = repoFiles().filter((f) => /\.(test|e2e)\.tsx?$/.test(f) && f !== 'tests/repo.test.ts')
    expect(tests.filter((f) => outside.test(read(f)))).toEqual([])
  })
})
