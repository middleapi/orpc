import type { InterceptorOptions, Value } from '@orpc/shared'
import type { StandardBody, StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext } from '../types'
import { allAbortSignal, defer, isAsyncIteratorObject, replicateAsyncIterator, replicateReadableStream, stringifyJSON, toArray, value } from '@orpc/shared'

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
   * @default ({ request }) => request.method === 'GET'
   */
  filter?: Value<boolean, [options: StandardLinkTransportInterceptorOptions<T>]>
}

export class DedupeLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~dedupe'
  before = ['~batch']

  private readonly groups: DedupeLinkPluginOptions<T>['groups']
  private readonly filter: Exclude<DedupeLinkPluginOptions<T>['filter'], undefined>

  private readonly queue: Map<DedupeLinkPluginGroup<T>, PendingDedupeRequest<T>[]> = new Map()

  constructor(options: NoInfer<DedupeLinkPluginOptions<T>>) {
    this.groups = options.groups
    this.filter = options.filter ?? (({ request }) => request.method === 'GET')
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

      return new Promise((resolve, reject) => {
        this.enqueue(group, interceptorOptions, resolve, reject)

        defer(() => {
          this.processPendingRequests()
        })
      })
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
      queue = []
      this.queue.set(group, queue)
    }

    const requestKey = createRequestKey(options.path, options.request)
    const matched = queue.find(item => item.requestKey === requestKey)

    if (matched) {
      matched.matchedOptions.push(options)
      matched.signals.push(options.request.signal)
      matched.resolves.push(resolve)
      matched.rejects.push(reject)
      return
    }

    queue.push({
      requestKey,
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
      for (const item of items) {
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

      const replicatedResponses = replicateLazyResponse(response, item.resolves.length)

      for (const resolve of item.resolves) {
        resolve(replicatedResponses.pop()!)
      }
    }
    catch (error) {
      for (const reject of item.rejects) {
        reject(error)
      }
    }
  }
}

type PendingDedupeRequest<T extends ClientContext> = {
  requestKey: string
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

function replicateLazyResponse(response: StandardLazyResponse, count: number): StandardLazyResponse[] {
  const replicated: StandardLazyResponse[] = []

  let bodyPromise: Promise<StandardBody> | undefined
  let replicatedAsyncIterators: StandardBody[] | undefined
  let replicatedReadableStream: ReadableStream[] | undefined

  for (let i = 0; i < count; i++) {
    let resolvedBody: { body: StandardBody } | undefined

    replicated.push({
      ...response,
      resolveBody: async (hint) => {
        if (resolvedBody) {
          return resolvedBody.body
        }

        bodyPromise ??= response.resolveBody(hint)
        const body = await bodyPromise

        if (isAsyncIteratorObject(body)) {
          replicatedAsyncIterators ??= replicateAsyncIterator(body, count)
          resolvedBody = { body: replicatedAsyncIterators.pop() }
        }
        else if (body instanceof ReadableStream) {
          replicatedReadableStream ??= replicateReadableStream(body, count)
          resolvedBody = { body: replicatedReadableStream.pop() }
        }
        else {
          resolvedBody = { body }
        }

        return resolvedBody.body
      },
    })
  }

  return replicated
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
