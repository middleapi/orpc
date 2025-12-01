import type { SerializedMessage } from './types'
import { stringifyJSON } from '@orpc/shared'

export interface ResumeStorageOptions {
  /**
   * How long (in seconds) to retain events for replay.
   *
   * When a client reconnects, stored events within this window can be replayed
   * to ensure no data is lost. Outside this window, missed events are dropped.
   *
   * @remarks
   * - Use 0, negative or infinite numbers to disable resume functionality
   * - Event cleanup is deferred for performance reasons — expired events may
   *   remain briefly beyond their retention time
   *
   * @default 0 (disabled)
   */
  retentionSeconds?: number

  /**
   * Interval (in seconds) between cleanup checks for the Durable Object.
   *
   * At each interval, verify whether the Durable Object is inactive
   * (no active WebSocket connections and no stored events). If inactive, all
   * data is deleted to free resources; otherwise, another check is scheduled.
   *
   * @default 12 * 60 * 60 (12 hours)
   */
  cleanupIntervalSeconds?: number

  /**
   * Prefix for the resume storage table schema.
   * Used to avoid naming conflicts with other tables in the same Durable Object.
   *
   * @default 'orpc:publisher:resume:'
   */
  schemaPrefix?: string
}

export class ResumeStorage {
  private readonly retentionSeconds: number
  private readonly cleanupIntervalSeconds: number
  private readonly schemaPrefix: string

  private isInitedSchema = false
  private isInitedAlarm = false
  private lastCleanupTime: number | undefined

  get isEnabled(): boolean {
    return Number.isFinite(this.retentionSeconds) && this.retentionSeconds > 0
  }

  constructor(
    private readonly ctx: DurableObjectState,
    options: ResumeStorageOptions = {},
  ) {
    this.retentionSeconds = options.retentionSeconds ?? 0
    this.cleanupIntervalSeconds = options.cleanupIntervalSeconds ?? 12 * 60 * 60
    this.schemaPrefix = options.schemaPrefix ?? 'orpc:publisher:resume:'
  }

  /**
   * Store an event and return the updated serialized message with an assigned ID.
   */
  async store(stringified: string): Promise<string> {
    if (!this.isEnabled) {
      return stringified
    }

    await this.ensureSchemaAndCleanup()

    const message: SerializedMessage = JSON.parse(stringified)

    const insertEvent = () => {
      /**
       * SQLite INTEGER can exceed JavaScript's safe integer range,
       * so we cast to TEXT for safe ID handling in resume operations.
       */
      const result = this.ctx.storage.sql.exec(
        `INSERT INTO "${this.schemaPrefix}events" (payload) VALUES (?) RETURNING CAST(id AS TEXT) as id`,
        stringified,
      )

      const id = result.one()?.id as string
      const updatedIdMessage: SerializedMessage = {
        ...message,
        meta: { ...message.meta, id },
      }

      return stringifyJSON(updatedIdMessage)
    }

    try {
      return insertEvent()
    }
    catch (e) {
      /**
       * On error (disk full, ID overflow, etc.), reset schema and retry.
       * May cause data loss, but prevents total failure.
       */
      console.error('Failed to insert event, resetting resume storage schema.', e)
      await this.resetSchema()
      return insertEvent()
    }
  }

  /**
   * Get all events after the specified lastEventId, ordered by ID ascending.
   */
  async getEventsAfter(lastEventId: string): Promise<string[]> {
    if (!this.isEnabled) {
      return []
    }

    await this.ensureSchemaAndCleanup()

    /**
     * SQLite INTEGER can exceed JavaScript's safe integer range,
     * so we cast to TEXT for safe resume ID comparison.
     */
    const result = this.ctx.storage.sql.exec(`
      SELECT CAST(id AS TEXT) as id, payload
      FROM "${this.schemaPrefix}events"
      WHERE id > ?
      ORDER BY id ASC
    `, lastEventId)

    const events: string[] = []
    for (const record of result.toArray()) {
      const message = JSON.parse(record.payload as string) as SerializedMessage
      const updatedIdMessage: SerializedMessage = {
        ...message,
        meta: { ...message.meta, id: record.id as string },
      }
      events.push(stringifyJSON(updatedIdMessage))
    }

    return events
  }

  /**
   * Auto-delete durable object data if inactive for extended period.
   * Inactivity means: no active connections AND no active events.
   */
  async alarm(): Promise<void> {
    this.isInitedAlarm = true // triggered from alarm means it's already initialized
    await this.ensureSchemaAndCleanup()

    const shouldReschedule = await this.ctx.blockConcurrencyWhile(async () => {
      const hasActiveWebSockets = this.ctx.getWebSockets().length > 0
      if (hasActiveWebSockets) {
        return true
      }

      const activeEventsCount = this.ctx.storage.sql.exec(`
        SELECT COUNT(*) as count
        FROM "${this.schemaPrefix}events"
      `)
      const hasActiveEvents = (activeEventsCount.one()?.count as number) > 0
      if (hasActiveEvents) {
        return true
      }

      // if durable object receive events after deletion, re-initialize should happen again
      // and reset before deleteAll to avoid errors
      this.isInitedSchema = false
      this.isInitedAlarm = false
      await this.ctx.storage.deleteAll()

      return false
    })

    if (shouldReschedule) {
      await this.scheduleAlarm()
    }
  }

  private async ensureSchemaAndCleanup(): Promise<void> {
    if (!this.isInitedAlarm) {
      const currentAlarm = await this.ctx.storage.getAlarm()
      // alarm may have been scheduled in a previous Durable Object session
      if (currentAlarm === null) {
        // ensure cleanup alarm/schedule is scheduled before anything schema-related
        await this.scheduleAlarm()
      }
      this.isInitedAlarm = true
    }

    if (!this.isInitedSchema) {
      const initTableResult = this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS "${this.schemaPrefix}events" (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payload TEXT NOT NULL,
          stored_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)

      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS "${this.schemaPrefix}idx_events_id" ON "${this.schemaPrefix}events" (id)
      `)

      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS "${this.schemaPrefix}idx_events_stored_at" ON "${this.schemaPrefix}events" (stored_at)
      `)

      this.isInitedSchema = true

      if (initTableResult.rowsWritten > 0) {
        this.lastCleanupTime = Date.now() // schema just created, nothing to cleanup
      }
    }

    const now = Date.now()

    // Defer cleanup to improve performance
    if (this.lastCleanupTime && this.lastCleanupTime + this.retentionSeconds * 1000 > now) {
      return
    }

    this.lastCleanupTime = now

    this.ctx.storage.sql.exec(`
      DELETE FROM "${this.schemaPrefix}events" WHERE stored_at < unixepoch() - ?
    `, this.retentionSeconds)
  }

  private async resetSchema(): Promise<void> {
    this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${this.schemaPrefix}events"`)
    this.isInitedSchema = false // make sure schema is re-initialized
    await this.ensureSchemaAndCleanup()
  }

  private scheduleAlarm(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + this.cleanupIntervalSeconds * 1000)
  }
}
