import { sleep } from '@orpc/shared'
import { exports } from 'cloudflare:workers'

type FetchHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>

let current: FetchHandler | undefined

/**
 * Sets the main Worker's fetch handler, so each test can run its own Worker
 * through `exports.default.fetch`, with every call a separate incoming request.
 */
export function setFetchHandler(handler: FetchHandler | undefined): void {
  current = handler
}

export function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return current!(request, env, ctx)
}

/**
 * Sends an incoming request to the main Worker and returns the response text.
 */
export async function fetchText(path: string, init?: RequestInit): Promise<string> {
  const response = await exports.default.fetch(`http://x${path}`, init)

  return response.text()
}

/**
 * Races with a timer of the current request, so a promise that never settles reports `'timeout'`.
 */
export function withTimeout<T>(promise: Promise<T>, ms = 1000): Promise<T | 'timeout'> {
  return Promise.race([promise, sleep(ms).then(() => 'timeout' as const)])
}
