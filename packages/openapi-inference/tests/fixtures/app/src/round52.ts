import { os, type } from '@orpc/server'

/** Interfaces extending a view of an error that declare their own `toJSON` */
export interface MsgView extends Pick<Error, 'message'> {
  toJSON(): string
}

export interface ErrLike extends Readonly<Error> {
  toJSON(): number
}

/** Classes extending a boxed primitive with their own `toJSON`, which `JSON.stringify` calls */
export class MyNum extends Number {
  toJSON(): string {
    return 'mn'
  }
}

export class MyStr extends String {
  toJSON(): number {
    return 2
  }
}

export class MyBool extends Boolean {
  toJSON(): string {
    return 'mb'
  }
}

export interface ViewToJSON {
  mv: MsgView
  el: ErrLike
}

export interface BoxedClassJson {
  n: MyNum
  s: MyStr
  b: MyBool
}

const withToJSON = <T extends object>(value: T, json: string): T & { toJSON(): string } =>
  Object.assign(value, { toJSON: () => json })

export const viewToJSON = (): ViewToJSON => ({
  mv: withToJSON(new Error('m'), 'mv'),
  el: Object.assign(new Error('e'), { toJSON: () => 1 }),
})

export const plainViewToJSON = (): ViewToJSON => ({
  mv: { message: 'm', toJSON: () => 'mv' },
  el: { name: 'Error', message: 'e', toJSON: () => 1 },
})

export const boxedClassJson = (): BoxedClassJson => ({
  n: new MyNum(1),
  s: new MyStr('s'),
  b: new MyBool(true),
})

/** In a class instance, which `JSON.stringify` writes */
export class BoxedClassHolder {
  n: MyNum = new MyNum(1)
  mv: MsgView = withToJSON(new Error('m'), 'mv')
}

export const roundFiftyTwo = {
  viewToJSON: os.handler(viewToJSON),
  plainViewToJSON: os.handler(plainViewToJSON),
  boxedClassJson: os.handler(boxedClassJson),
  boxedClassHolder: os.handler((): BoxedClassHolder => new BoxedClassHolder()),
}

export const roundFiftyTwoInputs = {
  viewToJSON: os.input(type<ViewToJSON>()).handler(() => 1),
  boxedClassJson: os.input(type<BoxedClassJson>()).handler(() => 1),
}
