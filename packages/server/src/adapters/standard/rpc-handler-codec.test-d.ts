import type { Context } from '../../context.ts'
import type { RPCHandlerCodecOptions } from './rpc-handler-codec.ts'

it('outputStatus must resolve to a number', () => {
  const _static: RPCHandlerCodecOptions<Context> = { outputStatus: 201 }
  const _fn: RPCHandlerCodecOptions<Context> = { outputStatus: () => 201 }

  // @ts-expect-error null is not a status
  const _null: RPCHandlerCodecOptions<Context> = { outputStatus: () => null }
  // @ts-expect-error undefined is not a status
  const _undefined: RPCHandlerCodecOptions<Context> = { outputStatus: () => undefined }
})
