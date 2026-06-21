import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { compareSequentialIds, once, SequentialIdGenerator } from '@orpc/shared'
import { getEventMeta, unwrapEvent, withEventMeta } from '@standardserver/core'
import { Publisher } from '../publisher'

export interface MemoryPublisherOptions extends PublisherOptions {
  /**
   * Configuration for event replay support.
   *
   * When enabled, published events are temporarily stored so new
   * subscribers can resume from a previous position using `lastEventId`.
   *
   * @default { enabled: false }
   */
  replay?: {
    /**
     * Whether event replay support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: boolean

    /**
     * How long (in seconds) to retain events for replay.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds?: number
  }
}

interface StoredEvent<T> {
  expiresAt: number
  payload: T
}

export class MemoryPublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly listenersMap: Map<keyof T, ((payload: any) => void)[]> = new Map()
  private readonly idGenerator = new SequentialIdGenerator()
  private readonly eventsMap: Map<keyof T, Array<StoredEvent<T[keyof T]>>> = new Map()
  private readonly replayEnabled: boolean
  private readonly replaySeconds: number

  constructor({ replay, ...options }: MemoryPublisherOptions = {}) {
    super(options)
    this.replayEnabled = replay?.enabled ?? false
    this.replaySeconds = replay?.seconds ?? 300
  }

  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    this.cleanup()

    if (this.replayEnabled) {
      const expiresAt = Date.now() + this.replaySeconds * 1000

      let bucket = this.eventsMap.get(event)
      if (!bucket) {
        this.eventsMap.set(event, bucket = [])
      }

      const [original, meta] = unwrapEvent(payload)

      // Attach a monotonically increasing ID for replay support.
      payload = withEventMeta(original, { ...meta, id: this.idGenerator.generate() })
      bucket.push({ expiresAt, payload })
    }

    const listeners = this.listenersMap.get(event)
    listeners?.forEach(listener => listener(payload))
  }

  protected async subscribeListener<K extends keyof T & string>(
    event: K,
    listener: (payload: T[K]) => void,
    options?: PublisherSubscribeListenerOptions,
  ): Promise<() => Promise<void>> {
    this.cleanup()

    if (this.replayEnabled && options?.lastEventId !== undefined) {
      const bucket = this.eventsMap.get(event)
      if (bucket?.length) {
        const startIdx = findReplayStartIndex(bucket, options.lastEventId)
        for (let i = startIdx; i < bucket.length; i++) {
          listener(bucket[i]!.payload as T[K])
        }
      }
    }

    let listeners = this.listenersMap.get(event)
    if (!listeners) {
      this.listenersMap.set(event, listeners = [])
    }

    listeners.push(listener)

    // Ensure the returned cleanup function is safe to call multiple times.
    return once(async () => {
      listeners.splice(listeners.indexOf(listener), 1)

      if (listeners.length === 0) {
        this.listenersMap.delete(event)
      }
    })
  }

  private lastCleanupTime: number = 0
  private cleanup(): void {
    if (!this.replayEnabled) {
      return
    }

    const now = Date.now()

    // Throttle: only run cleanup at most once per retention window.
    if (now - this.lastCleanupTime < this.replaySeconds * 1000) {
      return
    }

    this.lastCleanupTime = now

    for (const [key, bucket] of this.eventsMap) {
      bucket.splice(0, findFirstUnexpiredIndex(bucket, now))

      if (bucket.length === 0) {
        this.eventsMap.delete(key)
      }
    }
  }
}

function findReplayStartIndex<T>(
  bucket: Array<StoredEvent<T>>,
  lastEventId: string,
): number {
  let lo = 0
  let hi = bucket.length

  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const id = getEventMeta(bucket[mid]!.payload)?.id

    if (id !== undefined && compareSequentialIds(id, lastEventId) > 0) {
      hi = mid
    }
    else {
      lo = mid + 1
    }
  }

  return lo
}

function findFirstUnexpiredIndex<T>(
  bucket: Array<StoredEvent<T>>,
  now: number,
): number {
  let lo = 0
  let hi = bucket.length

  while (lo < hi) {
    const mid = (lo + hi) >>> 1

    if (bucket[mid]!.expiresAt <= now) {
      lo = mid + 1
    }
    else {
      hi = mid
    }
  }

  return lo
}
