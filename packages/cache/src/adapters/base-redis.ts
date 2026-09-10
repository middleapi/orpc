import type { RPCJsonSerialization } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from '../types'
import { RPCJsonSerializer } from '@orpc/client'
import { nowInSeconds, sleep, stringifyJSON } from '@orpc/shared'
import { encodeCacheKey, resolveCacheExpiry } from '../utils'

/**
 * Reads the entry as `[output, tags, expiresAt, evictAt, generation, snapshot]`,
 * dropping it when a tag was revalidated since it was stored. A missing or
 * stale entry also takes the lock; `generation` is then the number the fill
 * must still hold to store, and `snapshot` carries the versions of the tags
 * it will fill with, captured before the fill so a revalidation during it
 * still counts.
 */
const GET_SCRIPT = `
local token, lockPx, tagPrefix, now, fillTags = ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5]
local fields = redis.call('HMGET', KEYS[1], 'output', 'tags', 'tagVersions', 'expiresAt', 'evictAt')
local output, tags, versions, expiresAt, evictAt = fields[1], fields[2], fields[3], fields[4], fields[5]

if output and tags then
  local names = cjson.decode(tags)
  local snapshot = cjson.decode(versions)
  local keys = {}
  for i, name in ipairs(names) do
    keys[i] = tagPrefix .. name
  end
  local live = redis.call('MGET', unpack(keys))
  for i, name in ipairs(names) do
    if tonumber(live[i] or 0) ~= (snapshot[name] or 0) then
      redis.call('DEL', KEYS[1])
      output = false
      break
    end
  end
end

local stale = output and expiresAt and tonumber(expiresAt) <= tonumber(now)
local generation = false
local snapshot = false
if not output or stale then
  if redis.call('SET', KEYS[2], token, 'NX', 'PX', lockPx) then
    generation = redis.call('INCR', KEYS[3])
  end
  if generation and fillTags ~= '' then
    local names = cjson.decode(fillTags)
    local keys = {}
    for i, name in ipairs(names) do
      keys[i] = tagPrefix .. name
    end
    local live = redis.call('MGET', unpack(keys))
    local captured = {}
    for i, name in ipairs(names) do
      captured[name] = tonumber(live[i] or 0)
    end
    snapshot = cjson.encode(captured)
  end
end

return { output or false, tags or false, expiresAt or false, evictAt or false, generation, snapshot }
`

/**
 * Stores the entry with the tag versions captured when its fill started,
 * then releases the caller's lock. The write is fenced by the generation
 * the lock handed out: a holder whose lock expired and was taken over stores
 * nothing, and the generation is deleted once the latest fill stored, so it
 * only exists while a fill is in flight.
 */
const STORE_SCRIPT = `
local token, output, tags, tagVersions, expiresAt, evictAt, generation = ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7]

if redis.call('GET', KEYS[3]) == generation then
  local fields = { 'output', output }

  if tags ~= '' then
    fields[#fields + 1] = 'tags'
    fields[#fields + 1] = tags
    fields[#fields + 1] = 'tagVersions'
    fields[#fields + 1] = tagVersions
  end

  if expiresAt ~= '' then
    fields[#fields + 1] = 'expiresAt'
    fields[#fields + 1] = expiresAt
    fields[#fields + 1] = 'evictAt'
    fields[#fields + 1] = evictAt
  end

  redis.call('DEL', KEYS[1])
  redis.call('HSET', KEYS[1], unpack(fields))

  if evictAt ~= '' then
    redis.call('PEXPIREAT', KEYS[1], tonumber(evictAt) * 1000)
  end

  redis.call('DEL', KEYS[3])
end

if redis.call('GET', KEYS[2]) == token then
  redis.call('DEL', KEYS[2])
end
`

/**
 * Deletes the lock and the generation only while they are still the
 * caller's, leaving ones that expired and were taken over alone.
 */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end

if redis.call('GET', KEYS[2]) == ARGV[2] then
  redis.call('DEL', KEYS[2])
end
`

const REVALIDATE_SCRIPT = `
for _, key in ipairs(KEYS) do
  redis.call('INCR', key)
end
`

/**
 * Replies arrive parsed from some clients, such as Upstash, and raw from others.
 */
function parseReply(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

export interface BaseRedisCacheStoreOptions {
  /**
   * The prefix to use for Redis keys.
   *
   * @default undefined
   */
  prefix?: string

  /**
   * Serializer for keys and cached outputs.
   *
   * @default RPCJsonSerializer
   */
  serializer?: undefined | Public<RPCJsonSerializer>

  /**
   * How long a lock may be held, in seconds, so a crashed holder frees its
   * waiters. A fill outlasting it lets the next waiter fill as well.
   *
   * @default 10
   */
  lockTtl?: number
}

/**
 * Cache store for Redis-compatible databases, driven by Lua scripts so a hit
 * is one round trip and a miss two. Entries are hashes retained for
 * `ttl + swr`; tag counters have no expiry since expiring one would resurrect
 * stale entries. Revalidated entries are removed lazily on the next `getOrSet`
 * of their key. Concurrent callers of one key are coalesced through a lock
 * taken in the same script that reads the entry, so it spans processes.
 * Subclasses only run the scripts through their client.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export abstract class BaseRedisCacheStore implements CacheStore {
  private readonly entryPrefix: string
  private readonly lockPrefix: string
  private readonly generationPrefix: string
  private readonly tagPrefix: string
  private readonly lockPx: string
  private readonly serializer: Public<RPCJsonSerializer>

  constructor(options: BaseRedisCacheStoreOptions = {}) {
    const prefix = options.prefix ?? ''
    this.entryPrefix = `${prefix}e:`
    this.lockPrefix = `${prefix}l:`
    this.generationPrefix = `${prefix}g:`
    this.tagPrefix = `${prefix}t:`
    this.lockPx = String((options.lockTtl ?? 10) * 1000)
    this.serializer = options.serializer ?? new RPCJsonSerializer()
  }

  async getOrSet(key: unknown, fill: () => Promise<unknown>, options: CacheGetOrSetOptions = {}): Promise<CacheEntry> {
    const encodedKey = encodeCacheKey(key, this.serializer)
    const keys = [this.entryPrefix + encodedKey, this.lockPrefix + encodedKey, this.generationPrefix + encodedKey]
    const token = crypto.randomUUID()
    const fillTags = options.tags?.length ? stringifyJSON(options.tags) : ''

    while (true) {
      const [output, tags, expiresAt, evictAt, generation, snapshot] = await this.run(
        GET_SCRIPT,
        keys,
        [token, this.lockPx, this.tagPrefix, String(nowInSeconds()), fillTags],
      ) as [unknown, unknown, unknown, unknown, unknown, unknown]

      if (output !== null) {
        const entry: CacheEntry = {
          output: this.serializer.deserialize(parseReply(output) as RPCJsonSerialization),
          tags: tags === null ? undefined : parseReply(tags) as string[],
          expiresAt: expiresAt === null ? undefined : Number(expiresAt),
          evictAt: evictAt === null ? undefined : Number(evictAt),
        }

        if (generation !== null) {
          const refresh = this.store(keys, token, String(generation), fill, options, snapshot)
          options.waitUntil?.(refresh)
        }

        return entry
      }

      if (generation !== null) {
        return this.store(keys, token, String(generation), fill, options, snapshot)
      }

      await sleep(50)
    }
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await this.run(REVALIDATE_SCRIPT, tags.map(tag => this.tagPrefix + tag), [])
  }

  /**
   * Runs a Lua script through the client, by sha where the client supports
   * it, reloading the script when the server dropped it.
   */
  protected abstract run(script: string, keys: string[], args: string[]): Promise<unknown>

  private async store(keys: string[], token: string, generation: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions, snapshot: unknown): Promise<CacheEntry> {
    let output: unknown
    let serialized: string

    try {
      output = await fill()
      const { json, meta } = this.serializer.serialize(output)
      serialized = stringifyJSON({ json, meta })
    }
    catch (error) {
      await this.run(RELEASE_SCRIPT, keys.slice(1), [token, generation])
      throw error
    }

    const tags = options.tags?.length ? options.tags : undefined
    const { expiresAt, evictAt } = resolveCacheExpiry(options)

    await this.run(STORE_SCRIPT, keys, [
      token,
      serialized,
      tags !== undefined ? stringifyJSON(tags) : '',
      snapshot === null ? '' : typeof snapshot === 'string' ? snapshot : stringifyJSON(snapshot as object),
      expiresAt !== undefined ? String(expiresAt) : '',
      evictAt !== undefined ? String(evictAt) : '',
      generation,
    ])

    return { output, tags, expiresAt, evictAt }
  }
}
