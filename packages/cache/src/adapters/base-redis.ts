import type { RPCJsonSerialization } from '@orpc/client'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions } from './base-key-value'
import { nowInSeconds, stringifyJSON } from '@orpc/shared'
import { resolveCacheExpiry } from '../utils'
import { BaseKeyValueCacheStore } from './base-key-value'

interface BaseRedisCacheStoreEnvelope {
  output: RPCJsonSerialization
  /**
   * The tags, and the version counter each had when the fill started, index-aligned.
   */
  tags?: readonly string[]
  tagVersions?: readonly number[]
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

/**
 * Options shared by every Redis-backed cache store adapter.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export interface BaseRedisCacheStoreOptions extends BaseKeyValueCacheStoreOptions {
  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix?: string
}

/**
 * Base class for Redis-backed cache store adapters. Entries are JSON strings
 * retained for `ttl + swr`, and each tag is a counter that revalidation
 * increments; an entry records the counters of its tags when its fill
 * starts and is dropped once one moved. Only single-key commands are used,
 * so it works on Redis Cluster, and every adapter built on it shares the
 * same key and entry format. Fills are coalesced through the `locker`, in
 * the process by default; tag counters have no expiry since expiring one
 * would resurrect stale entries.
 *
 * Extend it and implement the abstract methods to support another Redis client.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export abstract class BaseRedisCacheStore extends BaseKeyValueCacheStore {
  private readonly entryPrefix: string
  private readonly tagPrefix: string

  constructor(options: BaseRedisCacheStoreOptions = {}) {
    super(options)
    const prefix = options.prefix ?? ''
    this.entryPrefix = `${prefix}e:`
    this.tagPrefix = `${prefix}t:`
  }

  /**
   * Reads a string key (`GET key`), `null` when it is missing. A client that
   * parses JSON replies may resolve with the parsed value.
   */
  protected abstract get(key: string): Promise<unknown>

  /**
   * Reads several string keys, `null` for each missing one (`MGET key [key ...]`).
   * Where a cluster forbids that, one `GET` per key sent together works too.
   */
  protected abstract getMany(keys: string[]): Promise<unknown[]>

  /**
   * Writes a string key, expiring after `px` milliseconds when given
   * (`SET key value [PX px]`).
   */
  protected abstract set(key: string, value: string, px: number | undefined): Promise<unknown>

  /**
   * Deletes a key (`DEL key`).
   */
  protected abstract delete(key: string): Promise<unknown>

  /**
   * Increments a counter key (`INCR key`).
   */
  protected abstract increment(key: string): Promise<unknown>

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await Promise.all(tags.map(tag => this.increment(this.tagPrefix + tag)))
  }

  protected async read(encodedKey: string, options: CacheGetOrSetOptions): Promise<CacheEntry | undefined> {
    const entryKey = this.entryPrefix + encodedKey
    const expectedTags = options.tags ?? []
    const [raw, expectedVersions] = await Promise.all([this.get(entryKey), this.versions(expectedTags)])

    if (raw === null || raw === undefined) {
      return undefined
    }

    const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as BaseRedisCacheStoreEnvelope

    if (envelope.evictAt !== undefined && nowInSeconds() >= envelope.evictAt) {
      await this.delete(entryKey)
      return undefined
    }

    if (envelope.tags?.length) {
      const versions = new Map(expectedTags.map((tag, index) => [tag, expectedVersions[index]]))
      const missing = envelope.tags.filter(tag => !versions.has(tag))

      if (missing.length) {
        const fetched = await this.versions(missing)
        missing.forEach((tag, index) => versions.set(tag, fetched[index]))
      }

      if (envelope.tags.some((tag, index) => versions.get(tag) !== (envelope.tagVersions?.[index] ?? 0))) {
        await this.delete(entryKey)
        return undefined
      }
    }

    return {
      output: this.serializer.deserialize(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
      evictAt: envelope.evictAt,
    }
  }

  protected async fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const tags = options.tags?.length ? options.tags : undefined
    const tagVersions = tags === undefined ? undefined : await this.versions(tags)
    const output = await fill()
    const { expiresAt, evictAt, retention } = resolveCacheExpiry(options)
    const { json, meta } = this.serializer.serialize(output)

    const envelope: BaseRedisCacheStoreEnvelope = {
      output: { json, meta },
      tags,
      tagVersions,
      expiresAt,
      evictAt,
    }

    await this.set(this.entryPrefix + encodedKey, stringifyJSON(envelope), retention === undefined ? undefined : retention * 1000)

    return { output, tags, expiresAt, evictAt }
  }

  private async versions(tags: readonly string[]): Promise<number[]> {
    if (!tags.length) {
      return []
    }

    const raw = await this.getMany(tags.map(tag => this.tagPrefix + tag))

    return raw.map(version => Number(version ?? 0))
  }
}
