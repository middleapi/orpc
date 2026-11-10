/* oxlint-disable typescript/no-wrapper-object-types -- interfaces extending boxed primitives and Function */
import { os, type } from '@orpc/server'

/** A view of `Error` with its own `toJSON` */
export interface MsgV extends Pick<Error, 'message'> {
  toJSON(): string
}

/** A readonly view of `Error` with its own `toJSON` */
export interface ErrLike extends Readonly<Error> {
  toJSON(): string
}

/** Views of interfaces extending a view of `Error` with their own `toJSON` */
export interface ErrorViewJsons {
  readonlyView: Readonly<MsgV>
  pickedView: Pick<MsgV, 'message' | 'toJSON'>
  codedView: MsgV & { code: number }
  readonlyErr: Readonly<ErrLike>
  codedErr: ErrLike & { code: number }
  intersection: Readonly<Pick<Error, 'message'> & { toJSON(): string }>
}

const jsonError = () => Object.assign(new Error('a'), { toJSON: () => 'x' })

export const errorViewJsons = (): ErrorViewJsons => ({
  readonlyView: jsonError(),
  pickedView: jsonError(),
  codedView: Object.assign(jsonError(), { code: 1 }),
  readonlyErr: jsonError(),
  codedErr: Object.assign(jsonError(), { code: 1 }),
  intersection: jsonError(),
})

/** The plain objects a client may send for them, written by their fields */
export const plainErrorViewJsons = (): ErrorViewJsons => {
  const plain = { message: 'm', toJSON: () => 'x' }
  const err = { ...plain, name: 'n' }
  return {
    readonlyView: plain,
    pickedView: plain,
    codedView: { ...plain, code: 1 },
    readonlyErr: err,
    codedErr: { ...err, code: 1 },
    intersection: plain,
  }
}

/** A subclass of `Number` written by its `toJSON` */
export class MyNum extends Number {
  toJSON(): string {
    return 'mn'
  }
}

/** A subclass of `String` written by its `toJSON` */
export class MyStr extends String {
  toJSON(): number {
    return 1
  }
}

/** A subclass of `Boolean` written by its `toJSON` */
export class MyBool extends Boolean {
  toJSON(): string {
    return 'b'
  }
}

/** A project interface extending `Number` with its own `toJSON` */
export interface INum extends Number {
  toJSON(): string
}

/** A project interface extending `String` with its own `toJSON` */
export interface IStr extends String {
  toJSON(): number
}

/** A project interface extending `Boolean` with its own `toJSON` */
export interface IBool extends Boolean {
  toJSON(): string
}

/** Interfaces extending boxed primitives, holding instances of subclasses */
export interface BoxedInterfaces {
  num: INum
  str: IStr
  bool: IBool
  cls: MyNum
}

export const boxedInterfaces = (): BoxedInterfaces => ({
  num: new MyNum(1),
  str: new MyStr('s'),
  bool: new MyBool(true),
  cls: new MyNum(2),
})

const numberMethods = {
  toFixed: () => '1',
  toExponential: () => '1',
  toPrecision: () => '1',
  toString: () => '1',
  toLocaleString: () => '1',
  valueOf: () => 1,
  toJSON: () => 'p',
}

/**
 * Plain objects of them (but of `String`), which the serializer walks without `toJSON`, as a
 * client may send (a value of a class type is an instance in outputs)
 */
export const plainBoxedInterfaces = (): BoxedInterfaces => ({
  num: numberMethods,
  str: new MyStr('t'),
  bool: { valueOf: () => true, toJSON: () => 'p' },
  cls: numberMethods,
})

/** A function with its own `toJSON` */
export interface JsonFn extends Function {
  toJSON(): string
}

/** Holds a function typed by an interface extending `Function` */
export interface JsonFns {
  fn: JsonFn
}

export const jsonFns = (): JsonFns => ({
  fn: Object.assign(() => 1, { toJSON: () => 'f' }),
})

export const roundFiftySeven = {
  errorViewJsons: os.handler(errorViewJsons),
  plainErrorViewJsons: os.handler(plainErrorViewJsons),
  readonlyMsgRoot: os.handler((): Readonly<MsgV> => jsonError()),
  codedErrRoot: os.handler((): ErrLike & { code: number } =>
    Object.assign(jsonError(), { code: 1 }),
  ),
  boxedInterfaces: os.handler(boxedInterfaces),
  numRoot: os.handler((): INum => new MyNum(1)),
  plainNumRoot: os.handler((): INum => numberMethods),
  jsonFns: os.handler(jsonFns),
  jsonFnRoot: os.handler((): JsonFn => Object.assign(() => 1, { toJSON: () => 'f' })),
}

export const roundFiftySevenInputs = {
  errorViewJsons: os.input(type<ErrorViewJsons>()).handler(() => 1),
  boxedInterfaces: os.input(type<BoxedInterfaces>()).handler(() => 1),
  jsonFns: os.input(type<JsonFns>()).handler(() => 1),
}
