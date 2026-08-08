/**
 * Node-only test double for Cloudflare's runtime-provided module.
 * Production builds keep the original `cloudflare:workers` import.
 */
export class WorkerEntrypoint<Env> {
  readonly env: Env

  constructor(_context: unknown, env: Env) {
    this.env = env
  }
}
