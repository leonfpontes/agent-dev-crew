// What a sandboxed child process may touch. Node's permission model (`--permission`) denies the
// file system, child processes, workers and native addons unless a flag allows them; the child
// starts with no environment variables except NODE_OPTIONS, which loads the network blocker
// (preload/block-network.mjs) into it and into every Node process it starts.

import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SandboxPolicy {
  /** Absolute folders the child may read (dependencies, the copy of the example repository). */
  read: string[]
  /** Absolute folders the child may write (only the copy of the example repository). */
  write: string[]
  /**
   * Let the child start Node child processes (a test runner's workers). They inherit the permission
   * flags and the blocker, which stops them from starting processes of their own. Worker threads are
   * never allowed: Node starts them without the permission model.
   */
  childProcesses?: boolean
  /** Let the child load native addons (the test runner's bundler). */
  addons?: boolean
}

/** The network blocker every sandboxed process loads (from src/ and from dist/ alike). */
export const BLOCKER = fileURLToPath(new URL('../preload/block-network.mjs', import.meta.url))

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
    ...[...policy.read, path.dirname(BLOCKER)].map((dir) => `--allow-fs-read=${realPath(dir)}`),
    ...policy.write.map((dir) => `--allow-fs-write=${realPath(dir)}`),
    ...(policy.childProcesses ? ['--allow-child-process'] : []),
    ...(policy.addons ? ['--allow-addons'] : []),
  ]
}

/** The environment a sandboxed child gets: only the blocker preload, nothing from the parent. */
export function sandboxEnv(): Record<string, string> {
  return { NODE_OPTIONS: `--import=${realPath(BLOCKER)}` }
}
