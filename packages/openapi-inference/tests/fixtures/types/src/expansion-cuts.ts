import { Readable } from 'node:stream'

import { z } from 'zod'

export interface ManyArrays {
  p0: { f0: string }[]
  p1: { f1: string }[]
  p2: { f2: string }[]
  p3: { f3: string }[]
  p4: { f4: string }[]
  p5: { f5: string }[]
  p6: { f6: string }[]
  p7: { f7: string }[]
  p8: { f8: string }[]
  p9: { f9: string }[]
  p10: { f10: string }[]
  p11: { f11: string }[]
  p12: { f12: string }[]
  p13: { f13: string }[]
  p14: { f14: string }[]
  p15: { f15: string }[]
  p16: { f16: string }[]
  p17: { f17: string }[]
  p18: { f18: string }[]
  p19: { f19: string }[]
  p20: { f20: string }[]
  p21: { f21: string }[]
  p22: { f22: string }[]
  p23: { f23: string }[]
  p24: { f24: string }[]
  p25: { f25: string }[]
  p26: { f26: string }[]
  p27: { f27: string }[]
  p28: { f28: string }[]
  p29: { f29: string }[]
  p30: { f30: string }[]
  p31: { f31: string }[]
  p32: { f32: string }[]
  p33: { f33: string }[]
  p34: { f34: string }[]
  p35: { f35: string }[]
  p36: { f36: string }[]
  p37: { f37: string }[]
  p38: { f38: string }[]
  p39: { f39: string }[]
  p40: { f40: string }[]
  p41: { f41: string }[]
  p42: { f42: string }[]
  p43: { f43: string }[]
  p44: { f44: string }[]
  p45: { f45: string }[]
  p46: { f46: string }[]
  p47: { f47: string }[]
  p48: { f48: string }[]
  p49: { f49: string }[]
  p50: { f50: string }[]
  p51: { f51: string }[]
  p52: { f52: string }[]
  p53: { f53: string }[]
  p54: { f54: string }[]
  p55: { f55: string }[]
  p56: { f56: string }[]
  p57: { f57: string }[]
  p58: { f58: string }[]
  p59: { f59: string }[]
  p60: { f60: string }[]
  p61: { f61: string }[]
  p62: { f62: string }[]
  p63: { f63: string }[]
  p64: { f64: string }[]
  p65: { f65: string }[]
  p66: { f66: string }[]
  p67: { f67: string }[]
  p68: { f68: string }[]
  p69: { f69: string }[]
}

export type Box<T> = { v: T }
export interface ManyBoxes {
  p0: Box<'v0'>
  p1: Box<'v1'>
  p2: Box<'v2'>
  p3: Box<'v3'>
  p4: Box<'v4'>
  p5: Box<'v5'>
  p6: Box<'v6'>
  p7: Box<'v7'>
  p8: Box<'v8'>
  p9: Box<'v9'>
  p10: Box<'v10'>
  p11: Box<'v11'>
  p12: Box<'v12'>
  p13: Box<'v13'>
  p14: Box<'v14'>
  p15: Box<'v15'>
  p16: Box<'v16'>
  p17: Box<'v17'>
  p18: Box<'v18'>
  p19: Box<'v19'>
  p20: Box<'v20'>
  p21: Box<'v21'>
  p22: Box<'v22'>
  p23: Box<'v23'>
  p24: Box<'v24'>
  p25: Box<'v25'>
  p26: Box<'v26'>
  p27: Box<'v27'>
  p28: Box<'v28'>
  p29: Box<'v29'>
  p30: Box<'v30'>
  p31: Box<'v31'>
  p32: Box<'v32'>
  p33: Box<'v33'>
  p34: Box<'v34'>
  p35: Box<'v35'>
  p36: Box<'v36'>
  p37: Box<'v37'>
  p38: Box<'v38'>
  p39: Box<'v39'>
  p40: Box<'v40'>
  p41: Box<'v41'>
  p42: Box<'v42'>
  p43: Box<'v43'>
  p44: Box<'v44'>
  p45: Box<'v45'>
  p46: Box<'v46'>
  p47: Box<'v47'>
  p48: Box<'v48'>
  p49: Box<'v49'>
  p50: Box<'v50'>
  p51: Box<'v51'>
  p52: Box<'v52'>
  p53: Box<'v53'>
  p54: Box<'v54'>
  p55: Box<'v55'>
  p56: Box<'v56'>
  p57: Box<'v57'>
  p58: Box<'v58'>
  p59: Box<'v59'>
  p60: Box<'v60'>
  p61: Box<'v61'>
  p62: Box<'v62'>
  p63: Box<'v63'>
  p64: Box<'v64'>
  p65: Box<'v65'>
  p66: Box<'v66'>
  p67: Box<'v67'>
  p68: Box<'v68'>
  p69: Box<'v69'>
}

export interface Hub {
  shared: {
    n0: N0
    n1: N1
    n2: N2
    n3: N3
    n4: N4
    n5: N5
    n6: N6
    n7: N7
    n8: N8
    n9: N9
    n10: N10
    n11: N11
    n12: N12
    n13: N13
    n14: N14
    n15: N15
    n16: N16
    n17: N17
    n18: N18
    n19: N19
  }
}
export interface N0 {
  id0: string
  s: Hub['shared']
}
export interface N1 {
  id1: string
  s: Hub['shared']
}
export interface N2 {
  id2: string
  s: Hub['shared']
}
export interface N3 {
  id3: string
  s: Hub['shared']
}
export interface N4 {
  id4: string
  s: Hub['shared']
}
export interface N5 {
  id5: string
  s: Hub['shared']
}
export interface N6 {
  id6: string
  s: Hub['shared']
}
export interface N7 {
  id7: string
  s: Hub['shared']
}
export interface N8 {
  id8: string
  s: Hub['shared']
}
export interface N9 {
  id9: string
  s: Hub['shared']
}
export interface N10 {
  id10: string
  s: Hub['shared']
}
export interface N11 {
  id11: string
  s: Hub['shared']
}
export interface N12 {
  id12: string
  s: Hub['shared']
}
export interface N13 {
  id13: string
  s: Hub['shared']
}
export interface N14 {
  id14: string
  s: Hub['shared']
}
export interface N15 {
  id15: string
  s: Hub['shared']
}
export interface N16 {
  id16: string
  s: Hub['shared']
}
export interface N17 {
  id17: string
  s: Hub['shared']
}
export interface N18 {
  id18: string
  s: Hub['shared']
}
export interface N19 {
  id19: string
  s: Hub['shared']
}
export type HubRoot = { s: Hub['shared'] }

export const Expr = class {
  b = 2
}
export type ExprInstance = InstanceType<typeof Expr>

export interface Thread<T> {
  item: T
  replies: Thread<{ parent: T }>[]
}
export type StringThread = Thread<string>

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type OptionalJson =
  | string
  | number
  | boolean
  | null
  | OptionalJson[]
  | { [key in string]?: OptionalJson }
/** Nullable status */
export type Status = 'open' | 'closed' | null
export interface Doc {
  id: string
  body?: Json
  status?: Status
  optionalJson: OptionalJson
}

export const plainWithToJSON = {
  a: 1,
  toJSON() {
    return 'x'
  },
}
export type PlainWithToJSON = typeof plainWithToJSON

export interface TreeItem {
  id: string
  children: TreeItem[]
}
export interface Dict {
  name: string
  entries: Record<string, Dict>
}
export interface WrappersFirst {
  items: TreeItem[]
  dicts: Record<string, Dict>
}

export class MyStream extends Readable {
  tag = 'x'
}
export class MyZodError extends z.ZodError {
  extra = 1
}
