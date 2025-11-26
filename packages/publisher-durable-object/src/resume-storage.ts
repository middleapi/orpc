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
   * How long (in seconds) of inactivity before auto-deleting the durable object's data.
   * Inactivity means no active WebSocket connections and no events within the retention period.
   *
   * The alarm is scheduled at `retentionSeconds + inactiveDataRetentionTime`.
   *
   * @default 6 * 60 * 60 (6 hours)
   */
  inactiveDataRetentionTime?: number

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
  private readonly inactiveDataRetentionTime: number
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
    this.inactiveDataRetentionTime = options.inactiveDataRetentionTime ?? 6 * 60 * 60
    this.schemaPrefix = options.schemaPrefix ?? 'orpc:publisher:resume:'
  }

  /**
   * Store an event and return the updated serialized message with an assigned ID.
   */
  async store(stringified: string): Promise<string> {
    if (!this.isEnabled) {
      return stringified
    }

    await this.ensureReady()

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
    catch {
      /**
       * On error (disk full, ID overflow, etc.), reset schema and retry.
       * May cause data loss, but prevents total failure.
       */
      await this.resetData()
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

    await this.ensureReady()

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
    this.isInitedAlarm = true // trigger form alarm means it's already initialized
    await this.ensureReady()

    const hasActiveWebSockets = this.ctx.getWebSockets().length > 0
    if (hasActiveWebSockets) {
      await this.scheduleAlarm()
      return
    }

    const activeEventsCount = this.ctx.storage.sql.exec(`
      SELECT COUNT(*) as count
      FROM "${this.schemaPrefix}events"
    `)

    const hasActiveEvents = (activeEventsCount.one()?.count as number) > 0
    if (hasActiveEvents) {
      await this.scheduleAlarm()
      return
    }

    await this.ctx.blockConcurrencyWhile(async () => {
      // if durable object receive events after deletion, re-initialize should happen again
      // and reset before deleteAll to avoid errors
      this.isInitedSchema = false
      this.isInitedAlarm = false
      await this.ctx.storage.deleteAll()
    })
  }

  private async ensureReady(): Promise<void> {
    if (this.isInitedSchema) {
      const now = Date.now()

      // Defer cleanup to improve performance
      if (this.lastCleanupTime && this.lastCleanupTime + this.retentionSeconds * 1000 > now) {
        return
      }

      this.lastCleanupTime = now

      this.ctx.storage.sql.exec(`
        DELETE FROM "${this.schemaPrefix}events" WHERE stored_at < unixepoch() - ?
      `, this.retentionSeconds)

      return
    }

    const result = this.ctx.storage.sql.exec(`
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
    if (!this.isInitedAlarm || result.rowsWritten > 0) {
      await this.scheduleAlarm()
      this.isInitedAlarm = true
    }
  }

  private async resetData(): Promise<void> {
    this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${this.schemaPrefix}events"`)
    this.isInitedSchema = false // make sure schema is re-initialized
    await this.ensureReady()
  }

  private scheduleAlarm(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + (this.retentionSeconds + this.inactiveDataRetentionTime) * 1000)
  }
}
