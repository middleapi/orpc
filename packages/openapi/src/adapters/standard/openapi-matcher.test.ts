import { oc } from '@orpc/contract'
import { os, withHiddenRouterContract } from '@orpc/server'
import { findAllRoutes } from 'rou3'
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

    it('supports param names that are not identifiers, and repeated names', async () => {
      const hyphen = os.meta(openapi({ method: 'GET', path: '/users/{user-id}' })).handler(() => 'ok')
      const digit = os.meta(openapi({ method: 'GET', path: '/digits/{0}/{1st}' })).handler(() => 'ok')
      const repeated = os.meta(openapi({ method: 'GET', path: '/repeated/{id}/{id}' })).handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ hyphen, digit, repeated })

      await expect(matcher.match('GET', '/users/a-id', undefined)).resolves.toEqual({
        path: ['hyphen'],
        procedure: hyphen,
        params: { 'user-id': 'a-id' },
      })

      await expect(matcher.match('GET', '/digits/a/b', undefined)).resolves.toEqual({
        path: ['digit'],
        procedure: digit,
        params: { '0': 'a', '1st': 'b' },
      })

      // the last value wins
      await expect(matcher.match('GET', '/repeated/a/b', undefined)).resolves.toEqual({
        path: ['repeated'],
        procedure: repeated,
        params: { id: 'b' },
      })
    })

    it('matches path text literally, even characters that are route syntax elsewhere', async () => {
      const ping = os.handler(() => 'pong')
      const dotPing = os.handler(() => 'pong')
      const star = os.handler(() => 'star')
      const group = os.handler(() => 'group')
      const batch = os.meta(openapi({ method: 'GET', path: '/items:batchGet' })).handler(() => 'batch')
      const braces = os.meta(openapi({ method: 'GET', path: '/a/{id}.json' })).handler(() => 'braces')
      const question = os.meta(openapi({ method: 'GET', path: '/what?' })).handler(() => 'question')

      const matcher = new OpenAPIMatcher({
        'ping': ping,
        '..': { ping: dotPing },
        '*': star,
        '(x)': group,
        batch,
        braces,
        question,
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toMatchObject({ procedure: ping })
      await expect(matcher.match('POST', '/../ping', undefined)).resolves.toMatchObject({ procedure: dotPing })

      await expect(matcher.match('POST', '/*', undefined)).resolves.toMatchObject({ procedure: star, params: undefined })
      await expect(matcher.match('POST', '/anything', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('POST', '/(x)', undefined)).resolves.toMatchObject({ procedure: group, params: undefined })
      await expect(matcher.match('POST', '/x', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/items:batchGet', undefined)).resolves.toMatchObject({ procedure: batch, params: undefined })
      await expect(matcher.match('GET', '/itemsfoo', undefined)).resolves.toBeUndefined()

      // only whole-segment `{name}` is a param
      await expect(matcher.match('GET', '/a/%7Bid%7D.json', undefined)).resolves.toMatchObject({ procedure: braces, params: undefined })
      await expect(matcher.match('GET', '/a/id.json', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/what%3F', undefined)).resolves.toMatchObject({ procedure: question, params: undefined })
      await expect(matcher.match('GET', '/what', undefined)).resolves.toBeUndefined()
    })

    it('matches path text whether the request path encodes it or not', async () => {
      const unicode = os.meta(openapi({ method: 'GET', path: '/café/{id}' })).handler(() => 'ok')
      const caret = os.meta(openapi({ method: 'GET', path: '/a^b' })).handler(() => 'ok')
      const colon = os.handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ unicode, caret, 'a:b': colon })

      for (const pathname of ['/caf%C3%A9/1', '/caf%c3%a9/1', '/café/1'] as const) {
        await expect(matcher.match('GET', pathname, undefined)).resolves.toEqual({
          path: ['unicode'],
          procedure: unicode,
          params: { id: '1' },
        })
      }

      for (const pathname of ['/a^b', '/a%5Eb'] as const) {
        await expect(matcher.match('GET', pathname, undefined)).resolves.toMatchObject({ procedure: caret })
      }

      for (const pathname of ['/a:b', '/a%3Ab'] as const) {
        await expect(matcher.match('POST', pathname, undefined)).resolves.toMatchObject({ procedure: colon })
      }
    })

    it('keeps empty segments inside catch-all params', async () => {
      const files = os.meta(openapi({ method: 'GET', path: '/files/{+path}' })).handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ files })

      await expect(matcher.match('GET', '/files/https%3A//example.com/a', undefined)).resolves.toEqual({
        path: ['files'],
        procedure: files,
        params: { path: 'https://example.com/a' },
      })

      await expect(matcher.match('GET', '/files//etc/hosts', undefined)).resolves.toEqual({
        path: ['files'],
        procedure: files,
        params: { path: '/etc/hosts' },
      })
    })

    it('matches segments after a catch-all param', async () => {
      const raw = os.meta(openapi({ method: 'GET', path: '/files/{+path}/raw' })).handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ raw })

      await expect(matcher.match('GET', '/files/a/b/raw', undefined)).resolves.toEqual({
        path: ['raw'],
        procedure: raw,
        params: { path: 'a/b' },
      })

      await expect(matcher.match('GET', '/files/a/b', undefined)).resolves.toBeUndefined()
    })

    it('requires a value for catch-all params, falling back to less specific routes', async () => {
      const files = os.meta(openapi({ method: 'GET', path: '/files/{+path}' })).handler(() => 'ok')

      await expect(new OpenAPIMatcher({ files }).match('GET', '/files', undefined)).resolves.toBeUndefined()
      await expect(new OpenAPIMatcher({ files }).match('GET', '/files/', undefined)).resolves.toBeUndefined()

      const fallback = os.meta(openapi({ method: 'GET', path: '/{+path}' })).handler(() => 'ok')
      const matcher = new OpenAPIMatcher({ files, fallback })

      await expect(matcher.match('GET', '/files', undefined)).resolves.toEqual({
        path: ['fallback'],
        procedure: fallback,
        params: { path: 'files' },
      })

      await expect(matcher.match('GET', '/files/a', undefined)).resolves.toEqual({
        path: ['files'],
        procedure: files,
        params: { path: 'a' },
      })
    })

    it('throws when a path has more than one catch-all param', () => {
      const procedure = os.meta(openapi({ method: 'GET', path: '/{+a}/x/{+b}' })).handler(() => 'ok')

      expect(() => new OpenAPIMatcher({ procedure })).toThrowError(
        'OpenAPI path "/{+a}/x/{+b}" has more than one catch-all param ({+name}), but only one is supported per path.',
      )
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

    it('resolves lazy routers whose prefix ends with a slash or holds a catch-all param', async () => {
      const info = os.meta(openapi({ method: 'GET', path: '/info' })).handler(() => 'info')

      const slashLoader = vi.fn(async () => ({ default: { info } }))
      const catchAllLoader = vi.fn(async () => ({ default: { info } }))

      const matcher = new OpenAPIMatcher({
        slash: os.meta(openapi({ prefix: '/api/' })).lazy(slashLoader),
        catchAll: os.meta(openapi({ prefix: '/files/{+path}' })).lazy(catchAllLoader),
      })

      await expect(matcher.match('GET', '/other/info', undefined)).resolves.toBeUndefined()
      expect(slashLoader).toHaveBeenCalledTimes(0)
      expect(catchAllLoader).toHaveBeenCalledTimes(0)

      await expect(matcher.match('GET', '/api/info', undefined)).resolves.toMatchObject({
        path: ['slash', 'info'],
        params: undefined,
      })
      expect(slashLoader).toHaveBeenCalledTimes(1)

      await expect(matcher.match('GET', '/files/a/b/info', undefined)).resolves.toMatchObject({
        path: ['catchAll', 'info'],
        params: { path: 'a/b' },
      })
      expect(catchAllLoader).toHaveBeenCalledTimes(1)
    })

    it('leaves a lazy router pending without indexing any of its routes when one path is invalid', async () => {
      const valid = os.meta(openapi({ method: 'GET', path: '/valid' })).handler(() => 'valid')
      const invalid = os.meta(openapi({ method: 'GET', path: '/{+a}/x/{+b}' })).handler(() => 'invalid')

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(async () => ({ default: { valid, invalid } })),
      })

      await expect(matcher.match('GET', '/valid', undefined)).rejects.toThrowError('more than one catch-all param')
      await expect(matcher.match('GET', '/valid', undefined)).rejects.toThrowError('more than one catch-all param')

      expect(findAllRoutes((matcher as any).tree, 'GET', '/valid')).toEqual([])
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

      // "%75" is "u": the prefix RegExp is tested against the raw pathname first and fails,
      // so the retry has to re-run lazy resolution against the normalized pathname
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
