import type { StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type { DurableIteratorWebsocket } from './websocket'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { getEventMeta, withEventMeta } from '@orpc/server'
import { fallback, parseEmptyableJSON, stringifyJSON } from '@orpc/shared'

export interface EventResumeStorageOptions extends StandardRPCJsonSerializerOptions {
  /**
   * How long (in seconds) to retain events for reconnection replay.
   *
   * When a client reconnects, stored events within this window can be replayed
   * to ensure no data is lost. Outside this window, missed events are dropped.
   *
   * @remarks
   * - Use infinite values to disable
   * - Note that for performance, expired event cleanup is deferred. This means
   *  expired events may remain in storage for a short period beyond their
   *  retention time.
   *
   * @default NaN (disabled)
   */
  resumeRetentionSeconds?: number

  /**
   * Prefix for the resume storage table schema.
   * This is used to avoid naming conflicts with other tables in the same Durable Object.
   *
   * @default 'orpc:durable-iterator:resume:'
   */
  resumeSchemaPrefix?: string
}

export interface ResumeEventFilter {
  /** Only websockets with these tags will receive the event */
  tags?: readonly string[]
  /** Only websockets that are in this list will receive the event */
  targets?: readonly DurableIteratorWebsocket[]
  /** Websockets that are in this list will not receive the event */
  exclude?: readonly DurableIteratorWebsocket[]
}

export class EventResumeStorage<T extends object> {
  private readonly serializer: StandardRPCJsonSerializer
  private readonly retentionSeconds: number
  private readonly schemaPrefix: string

  get isEnabled(): boolean {
    return Number.isFinite(this.retentionSeconds) && this.retentionSeconds > 0
  }

  constructor(
    private readonly durableState: DurableObjectState,
    options: EventResumeStorageOptions = {},
  ) {
    this.retentionSeconds = fallback(options.resumeRetentionSeconds, Number.NaN) // disabled by default
    this.schemaPrefix = fallback(options.resumeSchemaPrefix, 'orpc:durable-iterator:resume:')
    this.serializer = new StandardRPCJsonSerializer(options)

    if (this.isEnabled) {
      this.initSchema()
      this.cleanupExpiredEvents()
    }
  }

  /**
   * Store an payload for resume capability.
   *
   * @returns The updated meta of the stored payload
   */
  store(
    payload: T,
    resumeFilter: ResumeEventFilter,
  ): T {
    if (!this.isEnabled) {
      return payload
    }

    this.cleanupExpiredEvents()

    const serializedEvent = this.serializeEventPayload(payload)
    const targetIds = resumeFilter.targets?.map(
      ws => ws['~orpc'].deserializeId(),
    )
    const excludeIds = resumeFilter.exclude?.map(
      ws => ws['~orpc'].deserializeId(),
    )

    const insertEvent = () => {
      /**
       * SQLite INTEGER can exceed JavaScript's safe integer range,
       * so we cast to TEXT for safe ID handling in resume operations.
       */
      const insertResult = this.durableState.storage.sql.exec(
        `INSERT INTO "${this.schemaPrefix}events" (payload, tags, target_ids, exclusion_ids) VALUES (?, ?, ?, ?) RETURNING CAST(id AS TEXT) as id`,
        serializedEvent,
        stringifyJSON(resumeFilter.tags),
        stringifyJSON(targetIds),
        stringifyJSON(excludeIds),
      )

      const id = insertResult.one()?.id as string
      return this.withEventId(payload, id)
    }

    try {
      return insertEvent()
    }
    catch {
      /**
       * In the error case, like full disk, exceeding the max number of rows, etc.,
       * we reset the schema and try to insert again.
       * This can lead to data loss, but it's better than failing the entire operation.
       */
      this.resetSchema()
      return insertEvent()
    }
  }

  /**
   * Get events after lastEventId for a specific websocket
   */
  get(
    websocket: DurableIteratorWebsocket,
    lastEventId: string,
  ): T[] {
    if (!this.isEnabled) {
      return []
    }

    this.cleanupExpiredEvents()

    const websocketTags = websocket['~orpc'].deserializeTokenPayload().tags
    const websocketId = websocket['~orpc'].deserializeId()

    /**
     * SQLite INTEGER can exceed JavaScript's safe integer range,
     * so we cast to TEXT for safe resume ID comparison.
     */
    const resumeQuery = this.durableState.storage.sql.exec(`
      SELECT CAST(id AS TEXT) as id, payload, tags, target_ids, exclusion_ids
      FROM "${this.schemaPrefix}events"
      WHERE id > ?
      ORDER BY id ASC
    `, lastEventId)

    return resumeQuery
      .toArray()
      .filter((resumeRecord: Record<string, any>) => {
        const tags = parseEmptyableJSON(resumeRecord.tags) as string[] | undefined

        if (tags && !tags.some(tag => websocketTags?.includes(tag))) {
          return false
        }

        const resumeTargetIds = parseEmptyableJSON(resumeRecord.target_ids) as string[] | undefined
        const resumeExclusionIds = parseEmptyableJSON(resumeRecord.exclusion_ids) as string[] | undefined

        if (resumeTargetIds && !resumeTargetIds.includes(websocketId)) {
          return false
        }

        if (resumeExclusionIds && resumeExclusionIds.includes(websocketId)) {
          return false
        }

        return true
      })
      .map((resumeRecord: Record<string, any>) => this.withEventId(
        this.deserializeEventPayload(resumeRecord.payload),
        resumeRecord.id,
      ))
  }

  private initSchema(): void {
    this.durableState.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS "${this.schemaPrefix}events" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        tags TEXT,
        target_ids TEXT,
        exclusion_ids TEXT,
        stored_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    this.durableState.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS "${this.schemaPrefix}idx_events_id" ON "${this.schemaPrefix}events" (id)
    `)

    this.durableState.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS "${this.schemaPrefix}idx_events_stored_at" ON "${this.schemaPrefix}events" (stored_at)
    `)
  }

  private resetSchema(): void {
    this.durableState.storage.sql.exec(`
      DROP TABLE IF EXISTS "${this.schemaPrefix}events"
    `)

    this.initSchema()
  }

  private lastCleanupTime: number | undefined
  private cleanupExpiredEvents(): void {
    const now = Date.now()
    // defer cleanup to improve performance
    if (this.lastCleanupTime && this.lastCleanupTime + this.retentionSeconds * 1000 > now) {
      return
    }

    this.lastCleanupTime = now

    this.durableState.storage.sql.exec(`
      DELETE FROM "${this.schemaPrefix}events" WHERE stored_at < unixepoch() - ?
    `, this.retentionSeconds)
  }

  private serializeEventPayload(payload: T): string {
    const eventMeta = getEventMeta(payload)
    const [json, meta] = this.serializer.serialize({ payload, meta: eventMeta })
    return stringifyJSON({ json, meta })
  }

  private deserializeEventPayload(payload: string): T {
    const { json, meta } = JSON.parse(payload)
    const { payload: deserializedPayload, meta: eventMeta } = this.serializer.deserialize(json, meta) as {
      payload: T
      meta: ReturnType<typeof getEventMeta>
    }

    return eventMeta ? withEventMeta(deserializedPayload, eventMeta) : deserializedPayload
  }

  private withEventId(payload: T, id: string): T {
    return withEventMeta(payload, {
      ...getEventMeta(payload),
      id,
    })
  }
}
