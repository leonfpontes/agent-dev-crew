import { spawn } from 'node:child_process'

import { permissionFlags, realPath, sandboxEnv, type SandboxPolicy } from './permissions.js'

export interface SandboxResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  timeoutMs?: number
  cwd?: string
  /** Output kept per stream; the rest is cut (agent code can print a lot). */
  maxOutput?: number
}

/** Runs a Node script under the policy, with no environment, killed after `timeoutMs`. */
export function runNodeScript(
  script: string,
  policy: SandboxPolicy,
  { timeoutMs = 30_000, cwd, maxOutput = 200_000 }: RunOptions = {},
  args: string[] = [],
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...permissionFlags(policy), realPath(script), ...args], {
      cwd,
      env: sandboxEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const keep = (buffer: string, chunk: Buffer) =>
      buffer.length >= maxOutput ? buffer : (buffer + chunk.toString()).slice(0, maxOutput)
    child.stdout.on('data', (d: Buffer) => (stdout = keep(stdout, d)))
    child.stderr.on('data', (d: Buffer) => (stderr = keep(stderr, d)))
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr, timedOut })
    })
  })
}
