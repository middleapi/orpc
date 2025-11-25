import type { SerializedMessage } from './types'
import { fallback, stringifyJSON } from '@orpc/shared'
import { DurableObject } from 'cloudflare:workers'

export interface PublisherDurableObjectOptions {
  /**
   * How long (in seconds) to retain events for replay.
   *
   * When a client reconnects, stored events within this window can be replayed
   * to ensure no data is lost. Outside this window, missed events are dropped.
   *
   * @remarks
   * - Use non-finite values (NaN, Infinity) to disable resume functionality
   * - Event cleanup is deferred for performance reasons — expired events may
   *   remain briefly beyond their retention time
   *
   * @default NaN (disabled)
   */
  resumeRetentionSeconds?: number

  /**
   * How long (in seconds) of inactivity before auto-deleting the durable object's data.
   * Inactivity means no active WebSocket connections and no events within the retention period.
   *
   * The alarm is scheduled at `resumeRetentionSeconds + inactivityThresholdSeconds` from init.
   * Only applies when resume is enabled.
   *
   * @default 86400 (24 hours)
   */
  inactivityThresholdSeconds?: number

  /**
   * Prefix for the resume storage table schema.
   * Used to avoid naming conflicts with other tables in the same Durable Object.
   *
   * @default 'orpc:publisher:resume:'
   */
  resumeSchemaPrefix?: string
}

// eslint-disable-next-line ts/no-empty-object-type -- Props = {} is default behavior of DurableObject
export class PublisherDurableObject<Env = Cloudflare.Env, Props = {}> extends DurableObject<Env, Props> {
  private readonly resumeRetentionSeconds: number
  private readonly inactivityThresholdSeconds: number
  private readonly resumeSchemaPrefix: string

  get isResumeEnabled(): boolean {
    return Number.isFinite(this.resumeRetentionSeconds) && this.resumeRetentionSeconds > 0
  }

  constructor(ctx: DurableObjectState<Props>, env: Env, options: PublisherDurableObjectOptions = {}) {
    super(ctx, env)
    this.resumeRetentionSeconds = fallback(options.resumeRetentionSeconds, Number.NaN)
    this.inactivityThresholdSeconds = fallback(options.inactivityThresholdSeconds, 86400) // 24 hours
    this.resumeSchemaPrefix = fallback(options.resumeSchemaPrefix, 'orpc:publisher:resume:')

    if (this.isResumeEnabled) {
      const isNewTable = this.initSchema()

      if (isNewTable) {
        // First time initialization - schedule alarm for auto-cleanup
        this.ctx.waitUntil(this.scheduleAlarm())
      }
      else {
        // Existing table - cleanup expired events
        this.cleanupExpiredEvents()
      }
    }
  }

  override fetch(request: Request): Promise<Response> {
    if (request.url.includes('/publish')) {
      return this.handlePublish(request)
    }

    return this.handleSubscribe(request)
  }

  private async handlePublish(request: Request): Promise<Response> {
    let stringified = await request.text()

    if (this.isResumeEnabled) {
      stringified = this.storeEvent(stringified)
    }

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(stringified)
      }
      catch (e) {
        console.error('Failed to send message to websocket:', e)
      }
    }

    return new Response(null, { status: 204 })
  }

  private async handleSubscribe(request: Request): Promise<Response> {
    const { '0': client, '1': server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)

    const lastEventId = request.headers.get('last-event-id')
    if (lastEventId !== null && this.isResumeEnabled) {
      this.replayEvents(server, lastEventId)
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  private storeEvent(stringified: string): string {
    this.cleanupExpiredEvents()

    const insertEvent = () => {
      /**
       * SQLite INTEGER can exceed JavaScript's safe integer range,
       * so we cast to TEXT for safe ID handling in resume operations.
       */
      const result = this.ctx.storage.sql.exec(
        `INSERT INTO "${this.resumeSchemaPrefix}events" (payload) VALUES (?) RETURNING CAST(id AS TEXT) as id`,
        stringified,
      )

      const message: SerializedMessage = JSON.parse(stringified)
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
      this.resetSchema()
      return insertEvent()
    }
  }

  private replayEvents(websocket: WebSocket, lastEventId: string): void {
    this.cleanupExpiredEvents()

    /**
     * SQLite INTEGER can exceed JavaScript's safe integer range,
     * so we cast to TEXT for safe resume ID comparison.
     */
    const result = this.ctx.storage.sql.exec(`
      SELECT CAST(id AS TEXT) as id, payload
      FROM "${this.resumeSchemaPrefix}events"
      WHERE id > ?
      ORDER BY id ASC
    `, lastEventId)

    for (const record of result.toArray()) {
      try {
        const message = JSON.parse(record.payload as string) as SerializedMessage
        const updatedIdMessage: SerializedMessage = {
          ...message,
          meta: { ...message.meta, id: record.id as string },
        }
        websocket.send(stringifyJSON(updatedIdMessage))
      }
      catch (e) {
        console.error('Failed to replay event to websocket:', e)
      }
    }
  }

  private initSchema(): boolean {
    const result = this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS "${this.resumeSchemaPrefix}events" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        stored_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS "${this.resumeSchemaPrefix}idx_events_id" ON "${this.resumeSchemaPrefix}events" (id)
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS "${this.resumeSchemaPrefix}idx_events_stored_at" ON "${this.resumeSchemaPrefix}events" (stored_at)
    `)

    return result.rowsWritten > 0
  }

  private resetSchema(): void {
    this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${this.resumeSchemaPrefix}events"`)
    this.initSchema()
  }

  private lastCleanupTime: number | undefined
  private cleanupExpiredEvents(): void {
    const now = Date.now()

    // Defer cleanup to improve performance
    if (this.lastCleanupTime && this.lastCleanupTime + this.resumeRetentionSeconds * 1000 > now) {
      return
    }

    this.lastCleanupTime = now

    this.ctx.storage.sql.exec(`
      DELETE FROM "${this.resumeSchemaPrefix}events" WHERE stored_at < unixepoch() - ?
    `, this.resumeRetentionSeconds)
  }

  private scheduleAlarm(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + (this.resumeRetentionSeconds + this.inactivityThresholdSeconds) * 1000)
  }

  /**
   * Auto-delete durable object data if inactive for extended period.
   * Inactivity means: no active connections AND no active events.
   */
  override async alarm(): Promise<void> {
    const hasActiveConnections = this.ctx.getWebSockets().length > 0
    if (hasActiveConnections) {
      await this.scheduleAlarm()
      return
    }

    this.cleanupExpiredEvents()
    const result = this.ctx.storage.sql.exec(`
      SELECT COUNT(*) as count
      FROM "${this.resumeSchemaPrefix}events"
    `)

    const hasActiveEvents = (result.one()?.count as number) > 0
    if (hasActiveEvents) {
      await this.scheduleAlarm()
      return
    }

    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.deleteAll()
    })
  }
}
