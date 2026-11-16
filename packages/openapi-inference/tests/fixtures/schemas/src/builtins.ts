/** `toJSON` returning views of intersections with `object` */
export class ViewOfObjectJSON {
  toJSON(): Readonly<Date & object> {
    return new Date()
  }
}

export class ObjectViewJSON {
  toJSON(): Readonly<object & Date> {
    return new Date()
  }
}

interface Base {
  a: string
}
interface Left extends Base {
  left?: string
}
interface Right extends Base {
  right?: string
}
/** An interface reaching one base twice */
export interface Diamond extends Left, Right {}

export interface Diamonds {
  diamond: Readonly<Diamond>
}

/** A class holding a `Blob`, which `JSON.stringify` writes as `{}` */
export class Upload {
  file = new Blob([])
}

export interface Uploads {
  upload: Upload
}

/** Views of views, more than are followed */
export interface View0 extends Readonly<View1> {
  view0?: string
}
export interface View1 extends Readonly<View2> {
  view1?: string
}
export interface View2 extends Readonly<View3> {
  view2?: string
}
export interface View3 extends Readonly<View4> {
  view3?: string
}
export interface View4 extends Readonly<View5> {
  view4?: string
}
export interface View5 extends Readonly<View6> {
  view5?: string
}
export interface View6 extends Readonly<View7> {
  view6?: string
}
export interface View7 extends Readonly<View8> {
  view7?: string
}
export interface View8 extends Readonly<View9> {
  view8?: string
}
export interface View9 extends Readonly<View10> {
  view9?: string
}
export interface View10 extends Readonly<View11> {
  view10?: string
}
export interface View11 extends Readonly<View12> {
  view11?: string
}
export interface View12 extends Readonly<View13> {
  view12?: string
}
export interface View13 extends Readonly<View14> {
  view13?: string
}
export interface View14 extends Readonly<View15> {
  view14?: string
}
export interface View15 extends Readonly<View16> {
  view15?: string
}
export interface View16 extends Readonly<View17> {
  view16?: string
}
export interface View17 extends Readonly<View18> {
  view17?: string
}
export interface View18 extends Readonly<Date> {}

/** Interfaces extending interfaces, more than are followed */
export interface Chain0 extends Chain1 {
  chain0?: string
}
export interface Chain1 extends Chain2 {
  chain1?: string
}
export interface Chain2 extends Chain3 {
  chain2?: string
}
export interface Chain3 extends Chain4 {
  chain3?: string
}
export interface Chain4 extends Chain5 {
  chain4?: string
}
export interface Chain5 extends Chain6 {
  chain5?: string
}
export interface Chain6 extends Chain7 {
  chain6?: string
}
export interface Chain7 extends Chain8 {
  chain7?: string
}
export interface Chain8 extends Chain9 {
  chain8?: string
}
export interface Chain9 extends Chain10 {
  chain9?: string
}
export interface Chain10 extends Chain11 {
  chain10?: string
}
export interface Chain11 extends Chain12 {
  chain11?: string
}
export interface Chain12 extends Chain13 {
  chain12?: string
}
export interface Chain13 extends Chain14 {
  chain13?: string
}
export interface Chain14 extends Chain15 {
  chain14?: string
}
export interface Chain15 extends Chain16 {
  chain15?: string
}
export interface Chain16 extends Chain17 {
  chain16?: string
}
export interface Chain17 extends Chain18 {
  chain17?: string
}
export interface Chain18 extends Date {}

export interface Chains {
  view: View0
  chain: Chain0
}
