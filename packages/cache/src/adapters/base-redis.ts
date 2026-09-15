import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions, CacheEnvelope } from './base-key-value'
import { parseEmptyableJSON, stringifyJSON } from '@orpc/shared'
import { BaseKeyValueCacheStore } from './base-key-value'

interface BaseRedisCacheStoreEnvelope extends CacheEnvelope {
  /**
   * The version each tag had when the fill started, index-aligned with `tags`.
   */
  tagVersions?: readonly number[] | undefined
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
   * Increments a counter key (`INCR key`).
   */
  protected abstract increment(key: string): Promise<unknown>

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await Promise.all(tags.map(tag => this.increment(this.tagPrefix + tag)))
  }

  protected async read(encodedKey: string, options: CacheGetOrSetOptions): Promise<CacheEntry | undefined> {
    const expectedTags = options.tags ?? []
    const [raw, expectedVersions] = await Promise.all([this.get(this.entryPrefix + encodedKey), this.versions(expectedTags)])
    const envelope = (typeof raw === 'string' ? parseEmptyableJSON(raw) : raw) as BaseRedisCacheStoreEnvelope | null | undefined

    if (envelope == null) {
      return undefined
    }

    if (envelope.tags?.length) {
      const { tags } = envelope
      const versions = tags.length === expectedTags.length && tags.every((tag, index) => tag === expectedTags[index])
        ? expectedVersions
        : await this.versions(tags)

      const stored = envelope.tagVersions ?? []

      if (tags.some((_, index) => versions[index] !== (stored[index] ?? 0))) {
        return undefined
      }
    }

    return this.decode(envelope)
  }

  protected async fill(encodedKey: string, compute: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const tagVersions = options.tags?.length ? await this.versions(options.tags) : undefined
    const output = await compute()
    const { envelope, entry, retention } = this.encode(output, options)

    await this.set(
      this.entryPrefix + encodedKey,
      stringifyJSON({ ...envelope, tagVersions } satisfies BaseRedisCacheStoreEnvelope),
      retention,
    )

    return entry
  }

  private async versions(tags: readonly string[]): Promise<number[]> {
    if (!tags.length) {
      return []
    }

    const raw = await this.getMany(tags.map(tag => this.tagPrefix + tag))

    return raw.map(version => Number(version ?? 0))
  }
}
