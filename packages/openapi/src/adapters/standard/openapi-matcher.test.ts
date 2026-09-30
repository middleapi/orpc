import { oc } from '@orpc/contract'
import { os, withHiddenRouterContract } from '@orpc/server'
import { getOpenAPIMeta, openapi } from '../../meta'
import { OpenAPIMatcher } from './openapi-matcher'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openAPIMatcher', () => {
  describe('direct routes', () => {
    it('matches generated and explicit OpenAPI routes after pathname normalization', async () => {
      const ping = os.handler(() => 'pong')
      const echo = os
        .meta(openapi({ method: 'GET', path: '/nested/echo/{value}' }))
        .handler(() => 'echo')

      const matcher = new OpenAPIMatcher({
        ping,
        nested: { echo },
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('GET', '/nested/%65cho/dinwwwh%2F', undefined)).resolves.toEqual({
        path: ['nested', 'echo'],
        procedure: echo,
        params: { value: 'dinwwwh/' },
      })

      await expect(matcher.match('POST', '/nested/echo/dinwwwh%2F', undefined)).resolves.toBeUndefined()
    })

    it('normalizes trailing slashes in request paths and OpenAPI route definitions', async () => {
      const ping = os.handler(() => 'pong')
      const echo = os
        .meta(openapi({ method: 'GET', path: '/echo/' }))
        .handler(() => 'echo')

      const matcher = new OpenAPIMatcher({ ping, echo })

      await expect(matcher.match('POST', '/ping/', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('GET', '/echo', undefined)).resolves.toEqual({
        path: ['echo'],
        procedure: echo,
        params: undefined,
      })

      await expect(matcher.match('GET', '/echo/', undefined)).resolves.toEqual({
        path: ['echo'],
        procedure: echo,
        params: undefined,
      })
    })

    it('decodes catch-all params and trims trailing slashes', async () => {
      const files = os
        .meta(openapi({ method: 'GET', path: '/files/{+path}' }))
        .handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ files })

      await expect(matcher.match('GET', '/files/a/b/c%2Fd/', undefined)).resolves.toEqual({
        path: ['files'],
        procedure: files,
        params: { path: 'a/b/c/d' },
      })
    })

    it('applies OpenAPI prefixes to generated and explicit routes', async () => {
      const ping = os
        .meta(openapi({ prefix: '/api' }))
        .handler(() => 'pong')

      const echo = os
        .meta(openapi({ method: 'GET', prefix: '/api/v1', path: '/echo/{value}' }))
        .handler(() => 'echo')

      const matcher = new OpenAPIMatcher({ ping, echo })

      await expect(matcher.match('POST', '/api/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('GET', '/api/v1/echo/world', undefined)).resolves.toEqual({
        path: ['echo'],
        procedure: echo,
        params: { value: 'world' },
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toBeUndefined()
      await expect(matcher.match('GET', '/echo/world', undefined)).resolves.toBeUndefined()
    })

    it('supports filtering procedures during indexing', async () => {
      const ping = os.handler(() => 'pong')
      const secret = os.handler(() => 'hidden')
      const filter = vi.fn((_procedure: unknown, path: string[]) => !path.includes('secret'))

      const matcher = new OpenAPIMatcher({
        ping,
        internal: { secret },
      }, {
        filter,
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('POST', '/internal/secret', undefined)).resolves.toBeUndefined()

      expect(filter.mock.calls).toContainEqual([ping, ['ping']])
      expect(filter.mock.calls).toContainEqual([secret, ['internal', 'secret']])
    })

    it('keeps a param literally named __proto__ as an own property', async () => {
      const procedure = os
        .meta(openapi({ method: 'GET', path: '/a/{__proto__}' }))
        .handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ procedure })
      const result = await matcher.match('GET', '/a/value', undefined)

      expect(result).toBeDefined()
      expect(Object.keys(result!.params!)).toEqual(['__proto__'])
      expect(Object.getOwnPropertyDescriptor(result!.params!, '__proto__')?.value).toBe('value')
    })

    it('supports both normal and catch-all params at the same time', async () => {
      const procedure = os
        .meta(openapi({ method: 'GET', path: '/{name}/{+rest}' }))
        .handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ procedure })

      await expect(matcher.match('GET', '/a/b/c%2Fd/', undefined)).resolves.toEqual({
        path: ['procedure'],
        procedure,
        params: { name: 'a', rest: 'b/c/d' },
      })
    })
  })

  describe('static path text', () => {
    it('treats rou3 route syntax in explicit paths literally', async () => {
      // Google AIP-136 custom methods: rou3 would read ":batchGet" as a param
      const batchGet = os.meta(openapi({ method: 'POST', path: '/v1/files:batchGet' })).handler(() => 'batchGet')
      const batchCreate = os.meta(openapi({ method: 'POST', path: '/v1/files:batchCreate' })).handler(() => 'batchCreate')
      const star = os.meta(openapi({ method: 'GET', path: '/star/a*b' })).handler(() => 'star')
      const wildcard = os.meta(openapi({ method: 'GET', path: '/wildcard/*' })).handler(() => 'wildcard')
      const catchAll = os.meta(openapi({ method: 'GET', path: '/catch-all/**' })).handler(() => 'catchAll')
      const group = os.meta(openapi({ method: 'GET', path: '/group/(x)' })).handler(() => 'group')
      const braces = os.meta(openapi({ method: 'GET', path: '/braces/{id}:cancel/{a.b}' })).handler(() => 'braces')

      const matcher = new OpenAPIMatcher({ batchGet, batchCreate, star, wildcard, catchAll, group, braces })

      await expect(matcher.match('POST', '/v1/files:batchGet', undefined)).resolves.toEqual({
        path: ['batchGet'],
        procedure: batchGet,
        params: undefined,
      })

      await expect(matcher.match('POST', '/v1/files:batchCreate', undefined)).resolves.toEqual({
        path: ['batchCreate'],
        procedure: batchCreate,
        params: undefined,
      })

      await expect(matcher.match('POST', '/v1/files%3AbatchCreate', undefined)).resolves.toEqual({
        path: ['batchCreate'],
        procedure: batchCreate,
        params: undefined,
      })

      await expect(matcher.match('POST', '/v1/filesXYZ', undefined)).resolves.toBeUndefined()
      await expect(matcher.match('POST', '/v1/files:batchDelete', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/star/a*b', undefined)).resolves.toEqual({ path: ['star'], procedure: star, params: undefined })
      await expect(matcher.match('GET', '/star/a%2Ab', undefined)).resolves.toEqual({ path: ['star'], procedure: star, params: undefined })
      await expect(matcher.match('GET', '/star/aXb', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/wildcard/*', undefined)).resolves.toEqual({ path: ['wildcard'], procedure: wildcard, params: undefined })
      await expect(matcher.match('GET', '/wildcard/x', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/catch-all/**', undefined)).resolves.toEqual({ path: ['catchAll'], procedure: catchAll, params: undefined })
      await expect(matcher.match('GET', '/catch-all/x/y', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/group/(x)', undefined)).resolves.toEqual({ path: ['group'], procedure: group, params: undefined })
      await expect(matcher.match('GET', '/group/x', undefined)).resolves.toBeUndefined()

      // only whole segments like "{id}" are params, so these braces are static text
      await expect(matcher.match('GET', '/braces/{id}:cancel/{a.b}', undefined)).resolves.toEqual({ path: ['braces'], procedure: braces, params: undefined })
      await expect(matcher.match('GET', '/braces/%7Bid%7D:cancel/%7Ba.b%7D', undefined)).resolves.toEqual({ path: ['braces'], procedure: braces, params: undefined })
      await expect(matcher.match('GET', '/braces/1:cancel/a.b', undefined)).resolves.toBeUndefined()
    })

    it('treats rou3 route syntax in generated paths literally', async () => {
      const star = os.handler(() => 'star')
      const matcher = new OpenAPIMatcher({ 'a*b': star })

      await expect(matcher.match('POST', '/a*b', undefined)).resolves.toEqual({ path: ['a*b'], procedure: star, params: undefined })
      await expect(matcher.match('POST', '/aXb', undefined)).resolves.toBeUndefined()
    })

    it('prefers a static route over a param route regardless of how the request encodes it', async () => {
      const find = os.meta(openapi({ method: 'GET', path: '/files/{id}' })).handler(() => 'find')
      const search = os.meta(openapi({ method: 'GET', path: '/files/:search' })).handler(() => 'search')
      const info = os.meta(openapi({ method: 'GET', path: '/files/info' })).handler(() => 'info')

      const matcher = new OpenAPIMatcher({ find, search, info })

      await expect(matcher.match('GET', '/files/:search', undefined)).resolves.toEqual({ path: ['search'], procedure: search, params: undefined })
      await expect(matcher.match('GET', '/files/%3Asearch', undefined)).resolves.toEqual({ path: ['search'], procedure: search, params: undefined })
      await expect(matcher.match('GET', '/files/%69nfo', undefined)).resolves.toEqual({ path: ['info'], procedure: info, params: undefined })

      await expect(matcher.match('GET', '/files/:other', undefined)).resolves.toEqual({
        path: ['find'],
        procedure: find,
        params: { id: ':other' },
      })

      await expect(matcher.match('GET', '/files/a*(b)%2F%25', undefined)).resolves.toEqual({
        path: ['find'],
        procedure: find,
        params: { id: 'a*(b)/%' },
      })
    })

    it('matches non-ASCII characters and spaces in explicit paths however the request encodes them', async () => {
      const cafe = os.meta(openapi({ method: 'GET', path: '/café/{id}' })).handler(() => 'cafe')
      const hello = os.meta(openapi({ method: 'GET', path: '/hello world' })).handler(() => 'hello')
      const encoded = os.meta(openapi({ method: 'GET', path: '/already%20encoded' })).handler(() => 'encoded')

      const matcher = new OpenAPIMatcher({ cafe, hello, encoded })

      for (const pathname of ['/caf%C3%A9/1', '/caf%c3%a9/1', '/café/1'] as const) {
        await expect(matcher.match('GET', pathname, undefined)).resolves.toEqual({
          path: ['cafe'],
          procedure: cafe,
          params: { id: '1' },
        })
      }

      for (const pathname of ['/hello%20world', '/hello world'] as const) {
        await expect(matcher.match('GET', pathname, undefined)).resolves.toEqual({
          path: ['hello'],
          procedure: hello,
          params: undefined,
        })
      }

      for (const pathname of ['/already%20encoded', '/already encoded'] as const) {
        await expect(matcher.match('GET', pathname, undefined)).resolves.toEqual({
          path: ['encoded'],
          procedure: encoded,
          params: undefined,
        })
      }

      await expect(matcher.match('GET', '/cafe/1', undefined)).resolves.toBeUndefined()
      await expect(matcher.match('GET', '/hello%2520world', undefined)).resolves.toBeUndefined()
    })

    it('encodes static text in OpenAPI prefixes, including lazy router prefixes', async () => {
      const ping = os.meta(openapi({ prefix: '/v1:beta' })).handler(() => 'pong')
      const info = os.meta(openapi({ method: 'GET', path: '/info' })).handler(() => 'info')
      const loader = vi.fn(async () => ({ default: { info } }))

      const matcher = new OpenAPIMatcher({
        ping,
        cafe: os.meta(openapi({ prefix: '/café' })).lazy(loader),
      })

      await expect(matcher.match('POST', '/v1:beta/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })
      await expect(matcher.match('POST', '/v1Xbeta/ping', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/cafe/info', undefined)).resolves.toBeUndefined()
      expect(loader).not.toHaveBeenCalled()

      const result = await matcher.match('GET', '/caf%C3%A9/info', undefined)
      expect(result?.path).toEqual(['cafe', 'info'])
      expect(loader).toHaveBeenCalledTimes(1)
    })
  })

  describe('runtime prefix stripping', () => {
    it('strips prefixes before route matching, including trailing slash prefixes', async () => {
      const ping = os.handler(() => 'pong')
      const pong = os.meta(openapi({ path: '/' })).handler(() => 'pong')
      const matcher = new OpenAPIMatcher({ ping, pong })

      await expect(matcher.match('POST', '/api/v1/ping', '/api/v1')).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('POST', '/api/ping', '/api/')).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('POST', '/api', '/api')).resolves.toEqual({
        path: ['pong'],
        procedure: pong,
        params: undefined,
      })
    })

    it('mismatch when the runtime prefix is missing or not a full path segment', async () => {
      const ping = os.handler(() => 'pong')
      const matcher = new OpenAPIMatcher({ ping })

      await expect(matcher.match('POST', '/other/ping', '/api')).resolves.toBeUndefined()
      await expect(matcher.match('POST', '/apiping', '/api')).resolves.toBeUndefined()
    })
  })

  describe('lazy routers', () => {
    it('resolves unprefixed lazy routers once and reuses indexed routes', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info' }))
        .handler(() => 'info')

      const loader = vi.fn(async () => ({
        default: { info },
      }))

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(loader),
      })

      await expect(matcher.match('GET', '/info', undefined)).resolves.toEqual({
        path: ['lazy', 'info'],
        procedure: info,
        params: undefined,
      })

      await expect(matcher.match('GET', '/info', undefined)).resolves.toEqual({
        path: ['lazy', 'info'],
        procedure: info,
        params: undefined,
      })

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('resolves prefixed lazy routers only when the pathname matches the prefix pattern', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info/{tab}' }))
        .handler(() => 'info')

      const loader = vi.fn(async () => ({
        default: { info },
      }))

      const matcher = new OpenAPIMatcher({
        user: os.meta(openapi({ prefix: '/users/{userId}' })).lazy(loader),
      })

      await expect(matcher.match('GET', '/projects/42/info/general', undefined)).resolves.toBeUndefined()
      expect(loader).toHaveBeenCalledTimes(0)

      const firstResult = await matcher.match('GET', '/users/din/info/settings', undefined)

      expect(firstResult).toBeDefined()
      expect(firstResult!.path).toEqual(['user', 'info'])
      expect(firstResult!.params).toEqual({ userId: 'din', tab: 'settings' })
      expect(getOpenAPIMeta(firstResult!.procedure)).toMatchObject({
        method: 'GET',
        path: '/info/{tab}',
        prefix: '/users/{userId}',
      })

      await expect(matcher.match('GET', '/users/din/info/settings', undefined)).resolves.toEqual(firstResult)

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('retries a lazy router whose load fails, synchronously or asynchronously', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info' }))
        .handler(() => 'info')

      let attempts = 0
      const loader = vi.fn(() => {
        attempts++
        // the first attempt throws synchronously out of `unlazy`, the second rejects
        if (attempts === 1) {
          throw new Error('sync boom')
        }
        if (attempts === 2) {
          return Promise.reject(new Error('async boom'))
        }
        return Promise.resolve({ default: { info } })
      })

      const matcher = new OpenAPIMatcher({ lazy: os.lazy(loader as any) })

      await expect(matcher.match('GET', '/info', undefined)).rejects.toThrowError('sync boom')
      await expect(matcher.match('GET', '/info', undefined)).rejects.toThrowError('async boom')

      // a failed load must leave the router pending so a later match can still resolve it
      await expect(matcher.match('GET', '/info', undefined)).resolves.toEqual({
        path: ['lazy', 'info'],
        procedure: info,
        params: undefined,
      })

      expect(loader).toHaveBeenCalledTimes(3)
    })

    it('resolves a prefixed lazy router that only matches after percent-decoding', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info' }))
        .handler(() => 'info')

      const loader = vi.fn(async () => ({ default: { info } }))

      const matcher = new OpenAPIMatcher({
        user: os.meta(openapi({ prefix: '/users' })).lazy(loader),
      })

      // "%75" is "u": the prefix RegExp would fail against the raw pathname,
      // so lazy resolution has to run against the canonical pathname
      const result = await matcher.match('GET', '/%75sers/info', undefined)

      expect(result).toBeDefined()
      expect(result!.path).toEqual(['user', 'info'])
      expect(result!.params).toBeUndefined()
      expect(getOpenAPIMeta(result!.procedure)).toMatchObject({
        method: 'GET',
        path: '/info',
        prefix: '/users',
      })

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('resolves nested lazy routers added during the same match', async () => {
      const summary = os
        .meta(openapi({ method: 'GET', path: '/summary' }))
        .handler(() => 'summary')

      const projectLoader = vi.fn(async () => ({
        default: { summary },
      }))

      const outerLoader = vi.fn(async () => ({
        default: {
          project: os.meta(openapi({ prefix: '/projects/{projectId}' })).lazy(projectLoader),
        },
      }))

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(outerLoader),
      })

      const firstResult = await matcher.match('GET', '/projects/42/summary', undefined)

      expect(firstResult).toBeDefined()
      expect(firstResult!.path).toEqual(['lazy', 'project', 'summary'])
      expect(firstResult!.params).toEqual({ projectId: '42' })
      expect(getOpenAPIMeta(firstResult!.procedure)).toMatchObject({
        method: 'GET',
        path: '/summary',
        prefix: '/projects/{projectId}',
      })

      await expect(matcher.match('GET', '/projects/42/summary', undefined)).resolves.toEqual(firstResult)

      expect(outerLoader).toHaveBeenCalledTimes(1)
      expect(projectLoader).toHaveBeenCalledTimes(1)
    })

    it('resolves a deep lazy chain for concurrent matches without losing or reloading routers', async () => {
      const leaf1 = os.meta(openapi({ method: 'GET', path: '/leaf1' })).handler(() => '1')
      const leaf2 = os.meta(openapi({ method: 'GET', path: '/leaf2' })).handler(() => '2')
      const leaf3 = os.meta(openapi({ method: 'GET', path: '/leaf3' })).handler(() => '3')

      const loads = { l1: 0, l2: 0, l3: 0 }

      /** settle after N microtask turns so the three levels interleave */
      const settle = async (turns: number) => {
        for (let i = 0; i < turns; i++) {
          await Promise.resolve()
        }
      }

      const l3 = os.meta(openapi({ prefix: '/p3' })).lazy(async () => {
        loads.l3++
        await settle(2)
        return { default: { leaf3 } }
      })

      const l2 = os.meta(openapi({ prefix: '/p2' })).lazy(async () => {
        loads.l2++
        await settle(3)
        return { default: { leaf2, l3 } }
      })

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(async () => {
          loads.l1++
          await settle(4)
          return { default: { leaf1, l2 } }
        }),
      })

      const paths = ['/leaf1', '/p2/leaf2', '/p2/p3/leaf3'] as const
      const results = await Promise.all(
        paths.flatMap(path => [
          matcher.match('GET', path, undefined),
          matcher.match('GET', path, undefined),
        ]),
      )

      expect(results.map(result => result?.path.join('/'))).toEqual([
        'lazy/leaf1',
        'lazy/leaf1',
        'lazy/l2/leaf2',
        'lazy/l2/leaf2',
        'lazy/l2/l3/leaf3',
        'lazy/l2/l3/leaf3',
      ])

      // every level is loaded exactly once even though six matches raced for it
      expect(loads).toEqual({ l1: 1, l2: 1, l3: 1 })

      // and the deepest route stays matchable afterwards
      await expect(matcher.match('GET', '/p2/p3/leaf3', undefined)).resolves.toBeDefined()
      expect(loads).toEqual({ l1: 1, l2: 1, l3: 1 })
    })
  })

  describe('contract-first routers', () => {
    it('wraps implementations with contract metadata and caches wrapped procedures', async () => {
      const implementation = {
        ping: os
          .meta(openapi({ method: 'GET', path: '/implementation' }))
          .handler(() => 'pong'),
      }

      const contract = {
        ping: oc.meta(openapi({ method: 'DELETE', path: '/contract/{id}' })),
      }

      const matcher = new OpenAPIMatcher(withHiddenRouterContract(implementation, contract))
      const firstResult = await matcher.match('DELETE', '/contract/42', undefined)

      expect(firstResult).toBeDefined()
      expect(firstResult!.path).toEqual(['ping'])
      expect(firstResult!.params).toEqual({ id: '42' })
      expect(firstResult!.procedure).not.toBe(implementation.ping)
      expect(getOpenAPIMeta(firstResult!.procedure)).toMatchObject({
        method: 'DELETE',
        path: '/contract/{id}',
      })

      const secondResult = await matcher.match('DELETE', '/contract/42', undefined)

      expect(secondResult).toEqual(firstResult)
      expect(secondResult!.procedure).toBe(firstResult!.procedure) // ensure cache

      await expect(matcher.match('GET', '/implementation', undefined)).resolves.toBeUndefined()
    })

    it('throws when a contract-first implementation is missing', async () => {
      const matcher = new OpenAPIMatcher(withHiddenRouterContract({
        ping: os.handler(() => 'pong'),
      }, {
        missing: oc.meta(openapi({ method: 'GET', path: '/missing' })),
      }))

      await expect(matcher.match('GET', '/missing', undefined)).rejects.toThrowError(
        '[Contract-First] Missing or invalid implementation for procedure at path: "missing"',
      )
    })
  })
})
