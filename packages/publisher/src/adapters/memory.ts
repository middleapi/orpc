import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { compareSequentialIds, EventPublisher, SequentialIdGenerator } from '@orpc/shared'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { Publisher } from '../publisher'

export interface MemoryPublisherOptions extends PublisherOptions {
  /**
   * How long (in seconds) to retain events for replay.
   *
   * @remark
   * This allows new subscribers to "catch up" on missed events using `lastEventId`.
   * Note that event cleanup is deferred for performance reasons — meaning some
   * expired events may still be available for a short period of time, and listeners
   * might still receive them.
   *
   * @default NaN (disabled)
   */
  resumeRetentionSeconds?: number
}

export class MemoryPublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly eventPublisher = new EventPublisher<T>()
  private readonly idGenerator = new SequentialIdGenerator()
  private readonly retentionSeconds: number
  private readonly eventsMap: Map<keyof T, Array<{ expiresAt: number, payload: T[keyof T] }>> = new Map()

  /**
   * Useful for measuring memory usage.
   *
   * @internal
   *
   */
  get size(): number {
    let size = this.eventPublisher.size
    for (const events of this.eventsMap) {
      /* v8 ignore next 1 */
      size += events[1].length || 1 // empty array should never happen so we treat it as a single event
    }

    return size
  }

  protected get isResumeEnabled(): boolean {
    return Number.isFinite(this.retentionSeconds) && this.retentionSeconds > 0
  }

  constructor({ resumeRetentionSeconds, ...options }: MemoryPublisherOptions = {}) {
    super(options)

    this.retentionSeconds = resumeRetentionSeconds ?? Number.NaN
  }

  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    this.cleanup()

    if (this.isResumeEnabled) {
      const now = Date.now()
      const expiresAt = now + this.retentionSeconds * 1000

      let events = this.eventsMap.get(event)
      if (!events) {
        this.eventsMap.set(event, events = [])
      }

      payload = withEventMeta(payload, { ...getEventMeta(payload), id: this.idGenerator.generate() })
      events.push({ expiresAt, payload })
    }

    this.eventPublisher.publish(event, payload)
  }

  protected async subscribeListener<K extends keyof T & string>(event: K, listener: (payload: T[K]) => void, options?: PublisherSubscribeListenerOptions): Promise<() => Promise<void>> {
    if (this.isResumeEnabled && typeof options?.lastEventId === 'string') {
      const events = this.eventsMap.get(event)
      if (events) {
        for (const { payload } of events) {
          const id = getEventMeta(payload)?.id
          if (typeof id === 'string' && compareSequentialIds(id, options.lastEventId) > 0) {
            listener(payload as T[K])
          }
        }
      }
    }

    const syncUnsub = this.eventPublisher.subscribe(event, listener)

    return async () => {
      syncUnsub()
    }
  }

  protected lastCleanupTime: number | null = null
  protected cleanup(): void {
    if (!this.isResumeEnabled) {
      return
    }

    const now = Date.now()

    if (this.lastCleanupTime !== null && this.lastCleanupTime + this.retentionSeconds * 1000 > now) {
      return
    }

    this.lastCleanupTime = now

    for (const [event, events] of this.eventsMap) {
      const validEvents = events.filter(event => event.expiresAt > now)

      if (validEvents.length > 0) {
        this.eventsMap.set(event, validEvents)
      }
      else {
        this.eventsMap.delete(event)
      }
    }
  }
}
