import type { Client } from '@orpc/client'
import type { DurableObject } from 'cloudflare:workers'
import type { TokenAttachment } from '../object'
import type { DurableEventIteratorObjectWebsocketAttachment, DurableEventIteratorObjectWebsocketManager } from './websocket-manager'
import { implement, ORPCError } from '@orpc/server'
import { HibernationEventIterator } from '@orpc/server/hibernation'
import { get } from '@orpc/shared'
import { durableEventIteratorContract } from '../client/contract'
import { DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY, DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY } from './consts'

const os = implement(durableEventIteratorContract)

export interface DurableEventIteratorObjectRouterContext<
  TEventPayload extends object,
  TTokenAttachment extends TokenAttachment,
  TWsAttachment extends DurableEventIteratorObjectWebsocketAttachment,
  TEnv = unknown,
> {
  object: DurableObject<TEnv>
  currentWebsocket: WebSocket
  websocketManager: DurableEventIteratorObjectWebsocketManager<TEventPayload, TTokenAttachment, TWsAttachment>
}

const base = os.$context<DurableEventIteratorObjectRouterContext<any, any, any>>()

export const durableEventIteratorRouter = base.router({
  subscribe: base.subscribe.handler(({ context, lastEventId }) => {
    return new HibernationEventIterator<any>((hibernationId) => {
      context.websocketManager.serializeInternalAttachment(context.currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: hibernationId,
      })

      const payload = context.websocketManager.deserializeAttachment(context.currentWebsocket)[DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]

      context.websocketManager.sendEventsAfter(
        context.currentWebsocket,
        hibernationId,
        lastEventId !== undefined ? lastEventId : new Date((payload.iat - 1) * 1000),
      )
    })
  }),

  call: base.call.handler(async ({ context, input, signal, lastEventId }) => {
    if (await context.websocketManager.kickIfInvalid(context.currentWebsocket)) {
      throw new ORPCError('UNAUTHORIZED', {
        message: `Current token is invalid!`,
      })
    }
    const allowMethods = context.websocketManager.deserializeAttachment(context.currentWebsocket)[DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY].rpc
    const [method, ...path] = input.path

    if (!allowMethods?.includes(method)) {
      throw new ORPCError('FORBIDDEN', {
        message: `Method "${method}" is not allowed.`,
      })
    }
    const nestedClient = (context.object as any)[method](context.currentWebsocket)

    const client = get(nestedClient, path) as Client<any, any, any, any>

    return client(input.input, { signal, lastEventId })
  }),
})
