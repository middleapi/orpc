import type { InterceptorOptions, Value } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext } from '../types'
import { allAbortSignal, defer, isAsyncIteratorObject, runWithSignal, stringifyJSON, toArray, value } from '@orpc/shared'
import { replicateLazyResponse } from './utils'

export interface DedupeLinkPluginGroup<T extends ClientContext> {
  condition: Value<boolean, [options: StandardLinkTransportInterceptorOptions<T>]>
  /**
   * The context used for the rest of the request lifecycle.
   */
  context: Value<T, [items: [
    StandardLinkTransportInterceptorOptions<T>,
    StandardLinkTransportInterceptorOptions<T>,
    ...StandardLinkTransportInterceptorOptions<T>[],
  ]]>
}

export interface DedupeLinkPluginOptions<T extends ClientContext> {
  /**
   * To enable deduplication, a request must match at least one defined group.
   * Requests that fall into the same group are considered for deduplication together.
   */
  groups: [DedupeLinkPluginGroup<T>, ...DedupeLinkPluginGroup<T>[]]

  /**
   * Filters requests to dedupe.
   *
   * @default ({ request }) => request.method === 'GET' || request.method === 'QUERY'
   */
  filter?: Value<boolean, [options: StandardLinkTransportInterceptorOptions<T>]>

  /**
   * How long (in ms) to wait for more identical requests before sending,
   * counted from the first queued request.
   * With `0`, only requests made in the same event loop tick are deduplicated.
   *
   * @default 0
   */
  wait?: number
}

/**
 * Prevents redundant requests by deduplicating similar in-flight requests,
 * reducing the number of requests sent to the server.
 *
 * @see {@link https://orpc.dev/docs/plugins/dedupe | Dedupe Plugin}
 */
export class DedupeLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~dedupe'
  before = ['~batch']

  private readonly groups: DedupeLinkPluginOptions<T>['groups']
  private readonly filter: Exclude<DedupeLinkPluginOptions<T>['filter'], undefined>
  private readonly wait: Exclude<DedupeLinkPluginOptions<T>['wait'], undefined>

  private readonly queue: Map<DedupeLinkPluginGroup<T>, Map<string, PendingDedupeRequest<T>>> = new Map()

  constructor(options: NoInfer<DedupeLinkPluginOptions<T>>) {
    this.groups = options.groups
    this.filter = options.filter ?? (({ request }) => request.method === 'GET' || request.method === 'QUERY')
    this.wait = options.wait ?? 0
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = (interceptorOptions) => {
      if (!canDedupeRequest(interceptorOptions.request) || !value(this.filter, interceptorOptions)) {
        return interceptorOptions.next()
      }

      const group = this.groups.find(group => value(group.condition, interceptorOptions))

      if (!group) {
        return interceptorOptions.next()
      }

      // Each caller settles on its own signal, while the shared request keeps running until every caller aborts.
      return runWithSignal(interceptorOptions.request.signal, () => new Promise((resolve, reject) => {
        // Schedule only for the first queued request, so later ones cannot extend or split the wait.
        if (!this.queue.size) {
          defer(() => this.processPendingRequests(), this.wait)
        }

        this.enqueue(group, interceptorOptions, resolve, reject)
      }))
    }

    return {
      ...options,
      transportInterceptors: [...toArray(options.transportInterceptors), transportInterceptor],
    }
  }

  private enqueue(
    group: DedupeLinkPluginGroup<T>,
    options: InterceptorOptions<StandardLinkTransportInterceptorOptions<T>, Promise<StandardLazyResponse>>,
    resolve: (response: StandardLazyResponse) => void,
    reject: (error: unknown) => void,
  ): void {
    let queue = this.queue.get(group)

    if (!queue) {
      queue = new Map()
      this.queue.set(group, queue)
    }

    const requestKey = createRequestKey(options.path, options.request)
    const matched = queue.get(requestKey)

    if (matched) {
      matched.matchedOptions.push(options)
      matched.signals.push(options.request.signal)
      matched.resolves.push(resolve)
      matched.rejects.push(reject)
      return
    }

    queue.set(requestKey, {
      options,
      matchedOptions: [options],
      signals: [options.request.signal],
      resolves: [resolve],
      rejects: [reject],
    })
  }

  private async processPendingRequests(): Promise<void> {
    const pending = new Map(this.queue)
    this.queue.clear()

    const executions: Promise<void>[] = []

    for (const [group, items] of pending) {
      for (const item of items.values()) {
        executions.push(this.execute(group, item))
      }
    }

    await Promise.all(executions)
  }

  private async execute(
    group: DedupeLinkPluginGroup<T>,
    item: PendingDedupeRequest<T>,
  ): Promise<void> {
    try {
      if (!shouldDedupe(item.matchedOptions)) {
        const response = await item.options.next(item.options)
        item.resolves[0]?.(response)
        return
      }

      const context = value(group.context, item.matchedOptions) as T

      const request: StandardRequest = {
        ...item.options.request,
        signal: allAbortSignal(item.signals),
      }

      const response = await item.options.next({
        ...item.options,
        request,
        signal: request.signal,
        context,
      })

      const replicatedResponses = replicateLazyResponse(response, item.signals)

      item.resolves.forEach((resolve, index) => {
        resolve(replicatedResponses[index]!)
      })
    }
    catch (error) {
      for (const reject of item.rejects) {
        reject(error)
      }
    }
  }
}

type PendingDedupeRequest<T extends ClientContext> = {
  options: InterceptorOptions<StandardLinkTransportInterceptorOptions<T>, Promise<StandardLazyResponse>>
  matchedOptions: [
    StandardLinkTransportInterceptorOptions<T>,
    ...StandardLinkTransportInterceptorOptions<T>[],
  ]
  signals: (AbortSignal | undefined)[]
  resolves: ((response: StandardLazyResponse) => void)[]
  rejects: ((error: unknown) => void)[]
}

function canDedupeRequest(request: StandardRequest): boolean {
  return !(
    request.body instanceof Blob
    || request.body instanceof FormData
    || request.body instanceof URLSearchParams
    || request.body instanceof ReadableStream
    || isAsyncIteratorObject(request.body)
    || request.signal?.aborted
  )
}

function createRequestKey(path: string[], request: StandardRequest): string {
  return stringifyJSON({
    path,
    body: request.body,
    headers: request.headers,
    method: request.method,
    url: request.url,
  } satisfies Omit<StandardRequest, 'signal'> & { path: string[] })
}

function shouldDedupe<T extends ClientContext>(
  items: StandardLinkTransportInterceptorOptions<T>[],
): items is [
  StandardLinkTransportInterceptorOptions<T>,
  StandardLinkTransportInterceptorOptions<T>,
  ...StandardLinkTransportInterceptorOptions<T>[],
] {
  return items.length >= 2
}
