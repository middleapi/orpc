import type { EventMeta } from '@standard-server/core'
import { isPlainObject, stringifyJSON } from '@orpc/shared'
import { DurableObject } from 'cloudflare:workers'

export interface DurablePublisherObjectResumeOptions {
  /**
   * Whether event resume support is enabled.
   *
   * When enabled, published events are temporarily stored so new
   * subscribers can resume from a previous position using `lastEventId`.
   * Each stored event must fit within 2 MB, the Durable Object SQLite row limit,
   * so publishing a larger one fails.
   *
   * @default false
   */
  enabled: boolean

  /**
   * How long (in seconds) to retain events for resume.
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
   * Configuration for event resume support.
   *
   * When enabled, published events are temporarily stored so new
   * subscribers can resume from a previous position using `lastEventId`.
   *
   * @default { enabled: false }
   */
  resume?: DurablePublisherObjectResumeOptions
}

/**
 * Durable Object base class that backs `DurablePublisher`. Fans published events
 * out to WebSocket subscribers, with optional event storage for resume support.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class DurablePublisherObject<Env = Cloudflare.Env, Props = unknown> extends DurableObject<Env, Props> {
  private readonly resumeStorage: ResumeStorage

  constructor(ctx: DurableObjectState<Props>, env: Env, options: DurablePublisherObjectOptions = {}) {
    super(ctx, env)
    this.resumeStorage = new ResumeStorage(ctx, options.resume)
  }

  override fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return this.handleSubscribe(request)
    }

    return this.handlePublish(request)
  }

  private async handlePublish(request: Request): Promise<Response> {
    const body = await request.arrayBuffer()
    let stringifiedPayload = new TextDecoder().decode(body)

    try {
      stringifiedPayload = this.resumeStorage.store(stringifiedPayload, body.byteLength)
    }
    catch (e) {
      console.error('Failed to store published event:', e)

      if (e instanceof PayloadTooLargeError) {
        return new Response('Event payload too large', { status: 413 })
      }

      return new Response('Invalid or unprocessable event payload', { status: 400 })
    }

    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue
      }

      ws.send(stringifiedPayload)
    }

    return new Response(null, { status: 204 })
  }

  private async handleSubscribe(request: Request): Promise<Response> {
    const lastEventId = request.headers.get('last-event-id')
    const payloads = lastEventId === null ? [] : this.resumeStorage.getAfter(lastEventId)

    const { '0': client, '1': server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)

    for (const payload of payloads) {
      server.send(payload)
    }

    /**
     * Replayed events are the first messages on the socket, since nothing runs between
     * reading and sending them, so their count tells `DurablePublisher` where the replay ends.
     */
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'orpc-replayed-events': String(payloads.length) },
    })
  }

  override webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void | Promise<void> {
  }

  override async alarm(): Promise<void> {
    await this.resumeStorage.alarm()
  }
}

interface SerializedPayload {
  data: unknown
  meta?: EventMeta | null
}

/**
 * Durable Object SQLite rejects strings and rows larger than 2 MB.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
const MAX_STORED_PAYLOAD_BYTES = 2_000_000

class PayloadTooLargeError extends Error {}

class ResumeStorage {
  private readonly enabled: boolean
  private readonly seconds: number
  private readonly cleanupIntervalSeconds: number
  private readonly schemaPrefix: string

  private isInitedSchema = false
  private isInitedAlarm = false
  private lastCleanupTime: number | undefined

  constructor(
    private readonly ctx: DurableObjectState,
    options: DurablePublisherObjectResumeOptions = { enabled: false },
  ) {
    this.enabled = options.enabled
    this.seconds = options.seconds ?? 300
    this.cleanupIntervalSeconds = options.cleanupIntervalSeconds ?? 6 * 60 * 60
    const schemaPrefix = options.schemaPrefix ?? 'orpc:'
    this.schemaPrefix = schemaPrefix
  }

  /**
   * Store an event and return the updated serialized message with an assigned ID.
   * `byteLength` is the payload's size as UTF-8, which is how SQLite stores it.
   *
   * @throws {PayloadTooLargeError} if the payload is too large to store.
   * @throws if `stringifiedPayload` is not a JSON object with an optional object `meta`,
   * or if the insert fails, even after a schema reset retry.
   */
  store(stringifiedPayload: string, byteLength: number): string {
    if (!this.enabled) {
      return stringifiedPayload
    }

    if (byteLength > MAX_STORED_PAYLOAD_BYTES) {
      throw new PayloadTooLargeError(`Event payload exceeds ${MAX_STORED_PAYLOAD_BYTES} bytes`)
    }

    const payload: unknown = JSON.parse(stringifiedPayload)

    if (!isSerializedPayload(payload)) {
      throw new TypeError('Event payload must be a JSON object with an optional object `meta`')
    }

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

      return stringifyJSON(this.attachEventId(payload, result.one().id as string))
    }

    try {
      return insertEvent()
    }
    catch (e) {
      if (!isUnusableTableError(e)) {
        throw e
      }

      /**
       * The table cannot take more events (ID overflow, disk full, corruption, or a
       * mismatched schema), so drop it and retry once. May cause data loss, but prevents
       * total failure. If the retry also fails, the error propagates to the
       * caller so it can be surfaced as a clean error response.
       */
      console.error('Failed to insert event, resetting resume storage schema.', e)
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
     *
     * The alias must not be `id`: SQLite resolves ORDER BY to an output
     * alias before a table column, which would sort ids as text.
     *
     * Only events after `lastEventId` are replayed, so a subscriber never gets an
     * event twice or out of order. Ids restart at 1 once the table is wiped, so a
     * subscriber resuming from an older id may miss the events published since, and
     * an id that is not a number replays nothing, since SQLite sorts text after integers.
     */
    const result = this.ctx.storage.sql.exec(`
      SELECT CAST(id AS TEXT) AS event_id, payload
      FROM "${this.schemaPrefix}events"
      WHERE id > ?
      ORDER BY id ASC
    `, lastEventId)

    const events: string[] = []
    for (const record of result.toArray()) {
      const payload: SerializedPayload = JSON.parse(record.payload as string)
      events.push(stringifyJSON(this.attachEventId(payload, record.event_id as string)))
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

function isSerializedPayload(value: unknown): value is SerializedPayload {
  return isPlainObject(value) && (value.meta === undefined || value.meta === null || isPlainObject(value.meta))
}

/**
 * Whether an insert failed because the events table itself is unusable, rather than
 * because of the event: an exhausted id range or a full database (`SQLITE_FULL`),
 * corruption, or a table that was dropped or has a different schema.
 */
function isUnusableTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return /SQLITE_(?:FULL|CORRUPT|NOTADB)|no such table|no such column|has no column named/.test(message)
}
