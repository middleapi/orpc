type FetchHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>

let current: FetchHandler | undefined

/**
 * Sets the main Worker's fetch handler, so each test file can run its own Worker
 * through `exports.default.fetch`, with every call a separate incoming request.
 */
export function setFetchHandler(handler: FetchHandler | undefined): void {
  current = handler
}

export function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (current === undefined) {
    return Promise.resolve(new Response('No fetch handler set', { status: 500 }))
  }

  return current(request, env, ctx)
}
