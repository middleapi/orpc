import { os } from '@orpc/server'

/** Nullable all the way down */
export type DeepNull<T> = { [K in keyof T]: DeepNull<T[K]> | null }
/** Read-only all the way down, through a conditional type */
export type DeepIf<T> = T extends object ? { readonly [K in keyof T]: DeepIf<T[K]> } : T

/*
 * Rings of classes referring to the next ones, under deep mapped types. A check of a view reuses
 * what was found assuming an enclosing view is kept, while that one is being checked, so the
 * generation time grows linearly with the size of the ring.
 */

export class NullRingA {
  f0: NullRingB | null = null
  f1: NullRingD | null = null
  list: NullRingB[] = []
  u: NullRingB | string | undefined
}

export class NullRingB {
  f0: NullRingC | null = null
  f1: NullRingE | null = null
  list: NullRingC[] = []
  u: NullRingC | string | undefined
}

export class NullRingC {
  f0: NullRingD | null = null
  f1: NullRingF | null = null
  list: NullRingD[] = []
  u: NullRingD | string | undefined
}

export class NullRingD {
  f0: NullRingE | null = null
  f1: NullRingG | null = null
  list: NullRingE[] = []
  u: NullRingE | string | undefined
}

export class NullRingE {
  f0: NullRingF | null = null
  f1: NullRingH | null = null
  list: NullRingF[] = []
  u: NullRingF | string | undefined
}

export class NullRingF {
  f0: NullRingG | null = null
  f1: NullRingA | null = null
  list: NullRingG[] = []
  u: NullRingG | string | undefined
}

export class NullRingG {
  f0: NullRingH | null = null
  f1: NullRingB | null = null
  list: NullRingH[] = []
  u: NullRingH | string | undefined
}

export class NullRingH {
  f0: NullRingA | null = null
  f1: NullRingC | null = null
  list: NullRingA[] = []
  u: NullRingA | string | undefined
}

export class IfRingA {
  f0: IfRingB | null = null
  f1: IfRingD | null = null
  f2: IfRingH | null = null
  list: IfRingB[] = []
  tags = new Set<string>(['A'])
  map = new Map<string, IfRingD>()
  u: IfRingH | string | undefined
}

export class IfRingB {
  f0: IfRingC | null = null
  f1: IfRingE | null = null
  f2: IfRingI | null = null
  list: IfRingC[] = []
  tags = new Set<string>(['B'])
  map = new Map<string, IfRingE>()
  u: IfRingI | string | undefined
}

export class IfRingC {
  f0: IfRingD | null = null
  f1: IfRingF | null = null
  f2: IfRingJ | null = null
  list: IfRingD[] = []
  tags = new Set<string>(['C'])
  map = new Map<string, IfRingF>()
  u: IfRingJ | string | undefined
}

export class IfRingD {
  f0: IfRingE | null = null
  f1: IfRingG | null = null
  f2: IfRingK | null = null
  list: IfRingE[] = []
  tags = new Set<string>(['D'])
  map = new Map<string, IfRingG>()
  u: IfRingK | string | undefined
}

export class IfRingE {
  f0: IfRingF | null = null
  f1: IfRingH | null = null
  f2: IfRingL | null = null
  list: IfRingF[] = []
  tags = new Set<string>(['E'])
  map = new Map<string, IfRingH>()
  u: IfRingL | string | undefined
}

export class IfRingF {
  f0: IfRingG | null = null
  f1: IfRingI | null = null
  f2: IfRingM | null = null
  list: IfRingG[] = []
  tags = new Set<string>(['F'])
  map = new Map<string, IfRingI>()
  u: IfRingM | string | undefined
}

export class IfRingG {
  f0: IfRingH | null = null
  f1: IfRingJ | null = null
  f2: IfRingN | null = null
  list: IfRingH[] = []
  tags = new Set<string>(['G'])
  map = new Map<string, IfRingJ>()
  u: IfRingN | string | undefined
}

export class IfRingH {
  f0: IfRingI | null = null
  f1: IfRingK | null = null
  f2: IfRingO | null = null
  list: IfRingI[] = []
  tags = new Set<string>(['H'])
  map = new Map<string, IfRingK>()
  u: IfRingO | string | undefined
}

export class IfRingI {
  f0: IfRingJ | null = null
  f1: IfRingL | null = null
  f2: IfRingP | null = null
  list: IfRingJ[] = []
  tags = new Set<string>(['I'])
  map = new Map<string, IfRingL>()
  u: IfRingP | string | undefined
}

export class IfRingJ {
  f0: IfRingK | null = null
  f1: IfRingM | null = null
  f2: IfRingQ | null = null
  list: IfRingK[] = []
  tags = new Set<string>(['J'])
  map = new Map<string, IfRingM>()
  u: IfRingQ | string | undefined
}

export class IfRingK {
  f0: IfRingL | null = null
  f1: IfRingN | null = null
  f2: IfRingR | null = null
  list: IfRingL[] = []
  tags = new Set<string>(['K'])
  map = new Map<string, IfRingN>()
  u: IfRingR | string | undefined
}

export class IfRingL {
  f0: IfRingM | null = null
  f1: IfRingO | null = null
  f2: IfRingS | null = null
  list: IfRingM[] = []
  tags = new Set<string>(['L'])
  map = new Map<string, IfRingO>()
  u: IfRingS | string | undefined
}

export class IfRingM {
  f0: IfRingN | null = null
  f1: IfRingP | null = null
  f2: IfRingT | null = null
  list: IfRingN[] = []
  tags = new Set<string>(['M'])
  map = new Map<string, IfRingP>()
  u: IfRingT | string | undefined
}

export class IfRingN {
  f0: IfRingO | null = null
  f1: IfRingQ | null = null
  f2: IfRingA | null = null
  list: IfRingO[] = []
  tags = new Set<string>(['N'])
  map = new Map<string, IfRingQ>()
  u: IfRingA | string | undefined
}

export class IfRingO {
  f0: IfRingP | null = null
  f1: IfRingR | null = null
  f2: IfRingB | null = null
  list: IfRingP[] = []
  tags = new Set<string>(['O'])
  map = new Map<string, IfRingR>()
  u: IfRingB | string | undefined
}

export class IfRingP {
  f0: IfRingQ | null = null
  f1: IfRingS | null = null
  f2: IfRingC | null = null
  list: IfRingQ[] = []
  tags = new Set<string>(['P'])
  map = new Map<string, IfRingS>()
  u: IfRingC | string | undefined
}

export class IfRingQ {
  f0: IfRingR | null = null
  f1: IfRingT | null = null
  f2: IfRingD | null = null
  list: IfRingR[] = []
  tags = new Set<string>(['Q'])
  map = new Map<string, IfRingT>()
  u: IfRingD | string | undefined
}

export class IfRingR {
  f0: IfRingS | null = null
  f1: IfRingA | null = null
  f2: IfRingE | null = null
  list: IfRingS[] = []
  tags = new Set<string>(['R'])
  map = new Map<string, IfRingA>()
  u: IfRingE | string | undefined
}

export class IfRingS {
  f0: IfRingT | null = null
  f1: IfRingB | null = null
  f2: IfRingF | null = null
  list: IfRingT[] = []
  tags = new Set<string>(['S'])
  map = new Map<string, IfRingB>()
  u: IfRingF | string | undefined
}

export class IfRingT {
  f0: IfRingA | null = null
  f1: IfRingC | null = null
  f2: IfRingG | null = null
  list: IfRingA[] = []
  tags = new Set<string>(['T'])
  map = new Map<string, IfRingC>()
  u: IfRingG | string | undefined
}

export const nullRing = {
  root: os.handler((): DeepNull<NullRingA> => {
    const ring = new NullRingA()
    ring.f0 = new NullRingB()
    ring.list = [new NullRingB()]
    ring.u = 'u'
    return ring
  }),
}

export const conditionalRing = {
  ringA: os.handler((): DeepIf<IfRingA> => {
    const ring = new IfRingA()
    ring.f0 = new IfRingB()
    ring.map.set('k', new IfRingD())
    return ring
  }),
  ringB: os.handler((): DeepIf<IfRingB> => {
    const ring = new IfRingB()
    ring.f0 = new IfRingC()
    ring.map.set('k', new IfRingE())
    return ring
  }),
  ringC: os.handler((): DeepIf<IfRingC> => {
    const ring = new IfRingC()
    ring.f0 = new IfRingD()
    ring.map.set('k', new IfRingF())
    return ring
  }),
  ringD: os.handler((): DeepIf<IfRingD> => {
    const ring = new IfRingD()
    ring.f0 = new IfRingE()
    ring.map.set('k', new IfRingG())
    return ring
  }),
  ringE: os.handler((): DeepIf<IfRingE> => {
    const ring = new IfRingE()
    ring.f0 = new IfRingF()
    ring.map.set('k', new IfRingH())
    return ring
  }),
  ringF: os.handler((): DeepIf<IfRingF> => {
    const ring = new IfRingF()
    ring.f0 = new IfRingG()
    ring.map.set('k', new IfRingI())
    return ring
  }),
  ringG: os.handler((): DeepIf<IfRingG> => {
    const ring = new IfRingG()
    ring.f0 = new IfRingH()
    ring.map.set('k', new IfRingJ())
    return ring
  }),
  ringH: os.handler((): DeepIf<IfRingH> => {
    const ring = new IfRingH()
    ring.f0 = new IfRingI()
    ring.map.set('k', new IfRingK())
    return ring
  }),
  ringI: os.handler((): DeepIf<IfRingI> => {
    const ring = new IfRingI()
    ring.f0 = new IfRingJ()
    ring.map.set('k', new IfRingL())
    return ring
  }),
  ringJ: os.handler((): DeepIf<IfRingJ> => {
    const ring = new IfRingJ()
    ring.f0 = new IfRingK()
    ring.map.set('k', new IfRingM())
    return ring
  }),
  ringK: os.handler((): DeepIf<IfRingK> => {
    const ring = new IfRingK()
    ring.f0 = new IfRingL()
    ring.map.set('k', new IfRingN())
    return ring
  }),
  ringL: os.handler((): DeepIf<IfRingL> => {
    const ring = new IfRingL()
    ring.f0 = new IfRingM()
    ring.map.set('k', new IfRingO())
    return ring
  }),
  ringM: os.handler((): DeepIf<IfRingM> => {
    const ring = new IfRingM()
    ring.f0 = new IfRingN()
    ring.map.set('k', new IfRingP())
    return ring
  }),
  ringN: os.handler((): DeepIf<IfRingN> => {
    const ring = new IfRingN()
    ring.f0 = new IfRingO()
    ring.map.set('k', new IfRingQ())
    return ring
  }),
  ringO: os.handler((): DeepIf<IfRingO> => {
    const ring = new IfRingO()
    ring.f0 = new IfRingP()
    ring.map.set('k', new IfRingR())
    return ring
  }),
  ringP: os.handler((): DeepIf<IfRingP> => {
    const ring = new IfRingP()
    ring.f0 = new IfRingQ()
    ring.map.set('k', new IfRingS())
    return ring
  }),
  ringQ: os.handler((): DeepIf<IfRingQ> => {
    const ring = new IfRingQ()
    ring.f0 = new IfRingR()
    ring.map.set('k', new IfRingT())
    return ring
  }),
  ringR: os.handler((): DeepIf<IfRingR> => {
    const ring = new IfRingR()
    ring.f0 = new IfRingS()
    ring.map.set('k', new IfRingA())
    return ring
  }),
  ringS: os.handler((): DeepIf<IfRingS> => {
    const ring = new IfRingS()
    ring.f0 = new IfRingT()
    ring.map.set('k', new IfRingB())
    return ring
  }),
  ringT: os.handler((): DeepIf<IfRingT> => {
    const ring = new IfRingT()
    ring.f0 = new IfRingA()
    ring.map.set('k', new IfRingC())
    return ring
  }),
}
