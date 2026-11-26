import { os, type } from '@orpc/server'

/** A function with a field, which JSON leaves out */
export interface CallHandler extends CallableFunction {
  meta: string
}

/** A constructor with a field, which JSON leaves out */
export interface NewHandler extends NewableFunction {
  meta: string
}

export const callHandler = (): CallHandler => Object.assign(() => 1, { meta: 'm' })

/** A set whose `toJSON` a view of a date's adds, which `JSON.stringify` calls */
export class SetPickBox {
  s: Set<string> & Pick<Date, 'toJSON'> = Object.assign(new Set(['a']), { toJSON: () => 'x' })
}

/** Holds functions typed by interfaces extending `CallableFunction` and `NewableFunction` */
export class CallHandlerBox {
  c: CallHandler = callHandler()
  k: NewHandler = Object.assign(
    class {
      n = 1
    },
    { meta: 'm' },
  )
  n = 1
}

/** An error whose `toJSON` an intersection adds, which `JSON.stringify` calls */
export type LabelledError = Error & { toJSON(): string }

export const labelledError = (): LabelledError =>
  Object.assign(new Error('x'), { toJSON: () => 'err' })

/** A value an instance of a class implementing it sends by its `toJSON` */
export interface JsonPoint {
  x: number
  toJSON(): string
}

export class JsonPointImpl implements JsonPoint {
  x = 1

  toJSON(): string {
    return 'point'
  }
}

export const errorToJson = {
  callHandlerBox: os.handler((): CallHandlerBox => new CallHandlerBox()),
  plainCallHandlers: os.handler((): { c: CallHandler; n: number } => ({ c: callHandler(), n: 1 })),
  plainLabelledError: os.handler((): { e: LabelledError } => ({ e: labelledError() })),
  setPickBox: os.handler((): SetPickBox => new SetPickBox()),
}

/** Bytes whose `toJSON` an intersection adds, which `JSON.stringify` calls */
export type LabelledBytes = Uint8Array & { toJSON(): string }

export const labelledBytes = (): LabelledBytes =>
  Object.assign(new Uint8Array([1]), { toJSON: () => 'bytes' })

export const errorToJsonInputs = {
  plainLabelledError: os.input(type<{ e: LabelledError }>()).handler(() => 1),
  plainLabelledBytes: os.input(type<{ b: LabelledBytes }>()).handler(() => 1),
  jsonPoint: os.input(type<JsonPoint>()).handler(() => 1),
  jsonPoints: os.input(type<{ p: JsonPoint; list: JsonPoint[] }>()).handler(() => 1),
}
