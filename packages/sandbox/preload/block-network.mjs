// Loaded in every sandboxed Node process through NODE_OPTIONS=--import, so it also reaches the
// child processes a test runner starts. Node's permission model has no network switch, so this
// replaces every way out (sockets, TLS, UDP, DNS, fetch, WebSocket) with an error; in a test worker
// (a forked child with an IPC channel) it also stops starting processes. Plain JavaScript on
// purpose: it runs before any TypeScript loader.
import childProcess from 'node:child_process'
import dgram from 'node:dgram'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'

const blocked = (what) =>
  function blockedInSandbox() {
    const error = new Error(`${what} is blocked in the sandbox.`)
    error.code = 'ERR_CREW_SANDBOX_BLOCKED'
    throw error
  }

net.Socket.prototype.connect = blocked('Network access')
net.connect = net.createConnection = blocked('Network access')
tls.connect = blocked('Network access')
dgram.createSocket = blocked('Network access')
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  dns[name] = blocked('DNS')
  dns.promises[name] = blocked('DNS')
}
globalThis.fetch = async () => blocked('Network access')()
globalThis.WebSocket = blocked('Network access')

if (typeof process.send === 'function') {
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    childProcess[name] = blocked('Starting processes')
  }
}

// Named imports (`import { connect } from 'node:net'`) keep the original functions without this.
syncBuiltinESMExports()
