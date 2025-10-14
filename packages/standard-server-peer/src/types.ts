import type { Promisable } from '@orpc/shared'

export type EncodedMessage = object | string | ArrayBufferLike | Uint8Array

export interface EncodedMessageSendFn {
  (message: EncodedMessage, options?: StructuredSerializeOptions): Promisable<void>
}

export interface RequestOptions extends StructuredSerializeOptions {
  raw: boolean
}
