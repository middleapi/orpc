import type { ResumeStorageOptions } from './resume-storage'
import { DurableObject } from 'cloudflare:workers'
import { ResumeStorage } from './resume-storage'

export interface PublisherDurableObjectOptions {
  resume?: ResumeStorageOptions
}

export class PublisherDurableObject<Env = Cloudflare.Env, Props = unknown> extends DurableObject<Env, Props> {
  private readonly resumeStorage: ResumeStorage

  constructor(ctx: DurableObjectState<Props>, env: Env, options: PublisherDurableObjectOptions = {}) {
    super(ctx, env)
    this.resumeStorage = new ResumeStorage(ctx, options.resume)
  }

  override fetch(request: Request): Promise<Response> {
    if (request.url.includes('/publish')) {
      return this.handlePublish(request)
    }

    return this.handleSubscribe(request)
  }

  private async handlePublish(request: Request): Promise<Response> {
    const message = await this.resumeStorage.store(
      await request.text(),
    )

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message)
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
      const events = await this.resumeStorage.getEventsAfter(lastEventId)

      for (const event of events) {
        try {
          server.send(event)
        }
        catch (e) {
          console.error('Failed to replay event to websocket:', e)
        }
      }
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  override async alarm(): Promise<void> {
    await this.resumeStorage.alarm()
  }
}
