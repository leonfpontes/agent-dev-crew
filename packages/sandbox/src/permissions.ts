// What a sandboxed child process may touch. Node's permission model (`--permission`) denies the
// file system, child processes and workers unless a flag allows them; the child also starts with
// no environment variables, so a key in the parent's environment never reaches agent code.

import { realpathSync } from 'node:fs'
import path from 'node:path'

export interface SandboxPolicy {
  /** Absolute folders the child may read (dependencies, the copy of the example repository). */
  read: string[]
  /** Absolute folders the child may write (only the copy of the example repository). */
  write: string[]
}

/**
 * The real path of a folder, following symlinks; for a folder that doesn't exist yet, the real path
 * of its parent plus its name. Node checks permissions against real paths, so on macOS a policy for
 * `/var/folders/…` would never match `/private/var/folders/…`.
 */
export function realPath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    const parent = path.dirname(dir)
    return parent === dir ? dir : path.join(realPath(parent), path.basename(dir))
  }
}

/** Node flags for the policy. Relative paths are refused: the policy has to be unambiguous. */
export function permissionFlags(policy: SandboxPolicy): string[] {
  for (const dir of [...policy.read, ...policy.write]) {
    if (!path.isAbsolute(dir)) throw new Error(`Sandbox paths must be absolute: "${dir}".`)
  }
  return [
    '--permission',
    ...policy.read.map((dir) => `--allow-fs-read=${realPath(dir)}`),
    ...policy.write.map((dir) => `--allow-fs-write=${realPath(dir)}`),
  ]
}

/** The environment a sandboxed child gets: nothing. */
export const SANDBOX_ENV: Readonly<Record<string, string>> = Object.freeze({})
