import { spawn } from 'node:child_process'

import { permissionFlags, realPath, SANDBOX_ENV, type SandboxPolicy } from './permissions.js'

export interface SandboxResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Runs a Node script under the policy, with no environment, killed after `timeoutMs`. */
export function runNodeScript(
  script: string,
  policy: SandboxPolicy,
  { timeoutMs = 30_000, cwd }: { timeoutMs?: number; cwd?: string } = {},
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...permissionFlags(policy), realPath(script)], {
      cwd,
      env: { ...SANDBOX_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr, timedOut })
    })
  })
}
