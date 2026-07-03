import type { EventMeta } from '@standardserver/core'
import { stringifyJSON } from '@orpc/shared'
import { DurableObject } from 'cloudflare:workers'

export interface DurablePublisherObjectReplayOptions {
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

  /**
   * Interval (in seconds) between cleanup checks for the Durable Object.
   *
   * At each interval, verify whether the Durable Object is inactive
   * (no active WebSocket connections and no stored events). If inactive, all
   * data is deleted to free resources; otherwise, another check is scheduled.
   *
   * @default 6 * 60 * 60 (6 hours)
   */
  cleanupIntervalSeconds?: number

  /**
   * Prefix for the resume storage table schema.
   * Used to avoid naming conflicts with other tables in the same Durable Object.
   *
   * @default 'orpc:'
   */
  schemaPrefix?: string
}

export interface DurablePublisherObjectOptions {
  /**
   * Configuration for event replay support.
   *
   * When enabled, published events are temporarily stored so new
   * subscribers can resume from a previous position using `lastEventId`.
   *
   * @default { enabled: false }
   */
  replay?: DurablePublisherObjectReplayOptions
}

export class DurablePublisherObject<Env = Cloudflare.Env, Props = unknown> extends DurableObject<Env, Props> {
  private readonly replayStorage: ReplayStorage

  constructor(ctx: DurableObjectState<Props>, env: Env, options: DurablePublisherObjectOptions = {}) {
    super(ctx, env)
    this.replayStorage = new ReplayStorage(ctx, options.replay)
  }

  override fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return this.handleSubscribe(request)
    }

    return this.handlePublish(request)
  }

  private async handlePublish(request: Request): Promise<Response> {
    let stringifiedPayload = await request.text()

    try {
      stringifiedPayload = this.replayStorage.store(stringifiedPayload)
    }
    catch (e) {
      console.error('Failed to store published event:', e)
      return new Response('Invalid or unprocessable event payload', { status: 400 })
    }

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(stringifiedPayload)
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
    if (lastEventId !== null) {
      const payloads = this.replayStorage.getAfter(lastEventId)

      for (const payload of payloads) {
        server.send(payload)
      }
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  override async alarm(): Promise<void> {
    await this.replayStorage.alarm()
  }
}

interface SerializedPayload {
  data: unknown
  meta?: EventMeta
}

class ReplayStorage {
  private readonly enabled: boolean
  private readonly seconds: number
  private readonly cleanupIntervalSeconds: number
  private readonly schemaPrefix: string

  private isInitedSchema = false
  private isInitedAlarm = false
  private lastCleanupTime: number | undefined

  constructor(
    private readonly ctx: DurableObjectState,
    options: DurablePublisherObjectReplayOptions = { enabled: false },
  ) {
    this.enabled = options.enabled
    this.seconds = options.seconds ?? 300
    this.cleanupIntervalSeconds = options.cleanupIntervalSeconds ?? 6 * 60 * 60
    const schemaPrefix = options.schemaPrefix ?? 'orpc:'
    this.schemaPrefix = schemaPrefix
  }

  /**
   * Store an event and return the updated serialized message with an assigned ID.
   *
   * @throws if `stringified` is not valid JSON, or if the insert fails after
   * a schema reset retry.
   */
  store(stringifiedPayload: string): string {
    if (!this.enabled) {
      return stringifiedPayload
    }

    const payload: SerializedPayload = JSON.parse(stringifiedPayload)

    this.ensureSchemaAndCleanup()

    const insertEvent = () => {
      /**
       * SQLite INTEGER can exceed JavaScript's safe integer range,
       * so we cast to TEXT for safe ID handling in resume operations.
       */
      const result = this.ctx.storage.sql.exec(
        `INSERT INTO "${this.schemaPrefix}events" (payload) VALUES (?) RETURNING CAST(id AS TEXT) as id`,
        stringifiedPayload,
      )

      const row = result.one()
      return stringifyJSON(this.attachEventId(payload, row.id as string))
    }

    try {
      return insertEvent()
    }
    catch (e) {
      /**
       * On error (disk full, ID overflow, corrupted table, etc.), reset
       * schema and retry once. May cause data loss, but prevents total
       * failure. If the retry also fails, the error propagates to the
       * caller so it can be surfaced as a clean error response.
       */
      console.error('Failed to insert event, resetting replay storage schema.', e)
      this.resetSchema()
      return insertEvent()
    }
  }

  /**
   * Get all events after the specified lastEventId, ordered by ID ascending.
   * Must be sync function to dealing with race condition
   */
  getAfter(lastEventId: string): string[] {
    if (!this.enabled) {
      return []
    }

    this.ensureSchemaAndCleanup()

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
      const payload: SerializedPayload = JSON.parse(record.payload as string)
      events.push(stringifyJSON(this.attachEventId(payload, record.id as string)))
    }

    return events
  }

  /**
   * Auto-delete durable object data if inactive for extended period.
   * Inactivity means: no active connections AND no active events.
   */
  async alarm(): Promise<void> {
    this.isInitedAlarm = true // triggered from alarm means it's already initialized
    this.ensureSchemaAndCleanup()

    // Guards against a publish or new subscriber racing
    // with the idle check and deleteAll below.
    const shouldReschedule = await this.ctx.blockConcurrencyWhile(async () => {
      const hasActiveWebSockets = this.ctx.getWebSockets().length > 0
      if (hasActiveWebSockets) {
        return true
      }

      const activePayloadsRow = this.ctx.storage.sql.exec(`
        SELECT 1 as has FROM "${this.schemaPrefix}events" LIMIT 1
      `).toArray()
      if (activePayloadsRow.length) {
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

  private ensureSchemaAndCleanup(): void {
    if (!this.isInitedAlarm) {
      this.ctx.waitUntil(this.initAlarm())
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
    if (this.lastCleanupTime && this.lastCleanupTime + this.seconds * 1000 > now) {
      return
    }

    this.lastCleanupTime = now

    this.ctx.storage.sql.exec(`
      DELETE FROM "${this.schemaPrefix}events" WHERE stored_at < unixepoch() - ?
    `, this.seconds)
  }

  private async initAlarm(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm()

    /**
     * An alarm from a previous Durable Object instance may fire before the
     * next cleanup is due. In that case, reschedule it instead of reusing it.
     */
    const alarmFiresTooEarly = currentAlarm !== null
      && currentAlarm < Date.now() + this.seconds * 1000

    if (currentAlarm === null || alarmFiresTooEarly) {
      await this.scheduleAlarm()
    }

    this.isInitedAlarm = true
  }

  private resetSchema(): void {
    this.isInitedSchema = false
    this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${this.schemaPrefix}events"`)
    this.ensureSchemaAndCleanup()
  }

  private scheduleAlarm(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + this.cleanupIntervalSeconds * 1000)
  }

  private attachEventId(message: SerializedPayload, id: string): SerializedPayload {
    return {
      ...message,
      meta: { ...message.meta, id },
    }
  }
}
