import type { Promisable } from '@orpc/shared'
import type { encodeRequestMessage } from './codec'

export interface AdapterSendFn {
  (...args: [...Parameters<typeof encodeRequestMessage>, options?: StructuredSerializeOptions]): Promisable<void>
}

export type EncodedMessage = string | ArrayBufferLike | Uint8Array

export interface EncodedMessageSendFn {
  (message: EncodedMessage): Promisable<void>
}

export interface RequestOptions extends StructuredSerializeOptions {}
