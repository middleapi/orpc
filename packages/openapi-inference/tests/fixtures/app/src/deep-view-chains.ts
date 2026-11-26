import { os } from '@orpc/server'

/** Read-only all the way down */
export type DeepView<T> = { readonly [K in keyof T]: DeepView<T[K]> }

/*
 * Chains of classes whose field is a deep view of the next class, `DeepView<Next> | null`.
 * Each check of a view reuses what the views of the next classes were found to keep, so the
 * generation time grows linearly with the length of the chain.
 */

export class ShortLinkA {
  tags = new Set(['0'])
  m = new Map([['k', 0]])
  at = new Date(0)
  next: DeepView<ShortLinkB> | null = null

  get label(): string {
    return '0'
  }
}

export class ShortLinkB {
  tags = new Set(['1'])
  m = new Map([['k', 1]])
  at = new Date(0)
  next: DeepView<ShortLinkC> | null = null

  get label(): string {
    return '1'
  }
}

export class ShortLinkC {
  tags = new Set(['2'])
  m = new Map([['k', 2]])
  at = new Date(0)
  next: DeepView<ShortLinkD> | null = null

  get label(): string {
    return '2'
  }
}

export class ShortLinkD {
  tags = new Set(['3'])
  m = new Map([['k', 3]])
  at = new Date(0)
  next: DeepView<ShortLinkE> | null = null

  get label(): string {
    return '3'
  }
}

export class ShortLinkE {
  tags = new Set(['4'])
  m = new Map([['k', 4]])
  at = new Date(0)
  next: DeepView<ShortLinkF> | null = null

  get label(): string {
    return '4'
  }
}

export class ShortLinkF {
  tags = new Set(['5'])
  m = new Map([['k', 5]])
  at = new Date(0)
  next: DeepView<ShortLinkG> | null = null

  get label(): string {
    return '5'
  }
}

export class ShortLinkG {
  tags = new Set(['6'])
  m = new Map([['k', 6]])
  at = new Date(0)
  next: DeepView<ShortLinkH> | null = null

  get label(): string {
    return '6'
  }
}

export class ShortLinkH {
  tags = new Set(['7'])
  m = new Map([['k', 7]])
  at = new Date(0)
  next: null = null

  get label(): string {
    return '7'
  }
}

export class LongLinkA {
  tags = new Set(['0'])
  m = new Map([['k', 0]])
  at = new Date(0)
  next: DeepView<LongLinkB> | null = null

  get label(): string {
    return '0'
  }
}

export class LongLinkB {
  tags = new Set(['1'])
  m = new Map([['k', 1]])
  at = new Date(0)
  next: DeepView<LongLinkC> | null = null

  get label(): string {
    return '1'
  }
}

export class LongLinkC {
  tags = new Set(['2'])
  m = new Map([['k', 2]])
  at = new Date(0)
  next: DeepView<LongLinkD> | null = null

  get label(): string {
    return '2'
  }
}

export class LongLinkD {
  tags = new Set(['3'])
  m = new Map([['k', 3]])
  at = new Date(0)
  next: DeepView<LongLinkE> | null = null

  get label(): string {
    return '3'
  }
}

export class LongLinkE {
  tags = new Set(['4'])
  m = new Map([['k', 4]])
  at = new Date(0)
  next: DeepView<LongLinkF> | null = null

  get label(): string {
    return '4'
  }
}

export class LongLinkF {
  tags = new Set(['5'])
  m = new Map([['k', 5]])
  at = new Date(0)
  next: DeepView<LongLinkG> | null = null

  get label(): string {
    return '5'
  }
}

export class LongLinkG {
  tags = new Set(['6'])
  m = new Map([['k', 6]])
  at = new Date(0)
  next: DeepView<LongLinkH> | null = null

  get label(): string {
    return '6'
  }
}

export class LongLinkH {
  tags = new Set(['7'])
  m = new Map([['k', 7]])
  at = new Date(0)
  next: DeepView<LongLinkI> | null = null

  get label(): string {
    return '7'
  }
}

export class LongLinkI {
  tags = new Set(['8'])
  m = new Map([['k', 8]])
  at = new Date(0)
  next: DeepView<LongLinkJ> | null = null

  get label(): string {
    return '8'
  }
}

export class LongLinkJ {
  tags = new Set(['9'])
  m = new Map([['k', 9]])
  at = new Date(0)
  next: DeepView<LongLinkK> | null = null

  get label(): string {
    return '9'
  }
}

export class LongLinkK {
  tags = new Set(['10'])
  m = new Map([['k', 10]])
  at = new Date(0)
  next: DeepView<LongLinkL> | null = null

  get label(): string {
    return '10'
  }
}

export class LongLinkL {
  tags = new Set(['11'])
  m = new Map([['k', 11]])
  at = new Date(0)
  next: DeepView<LongLinkM> | null = null

  get label(): string {
    return '11'
  }
}

export class LongLinkM {
  tags = new Set(['12'])
  m = new Map([['k', 12]])
  at = new Date(0)
  next: DeepView<LongLinkN> | null = null

  get label(): string {
    return '12'
  }
}

export class LongLinkN {
  tags = new Set(['13'])
  m = new Map([['k', 13]])
  at = new Date(0)
  next: DeepView<LongLinkO> | null = null

  get label(): string {
    return '13'
  }
}

export class LongLinkO {
  tags = new Set(['14'])
  m = new Map([['k', 14]])
  at = new Date(0)
  next: DeepView<LongLinkP> | null = null

  get label(): string {
    return '14'
  }
}

export class LongLinkP {
  tags = new Set(['15'])
  m = new Map([['k', 15]])
  at = new Date(0)
  next: null = null

  get label(): string {
    return '15'
  }
}

export class MixedLinkA {
  tags = new Set(['0'])
  m = new Map([['k', 0]])
  at = new Date(0)
  next: Readonly<MixedLinkB> | null = null

  get label(): string {
    return '0'
  }
}

export class MixedLinkB {
  tags = new Set(['1'])
  m = new Map([['k', 1]])
  at = new Date(0)
  next: Partial<MixedLinkC> | null = null

  get label(): string {
    return '1'
  }
}

export class MixedLinkC {
  tags = new Set(['2'])
  m = new Map([['k', 2]])
  at = new Date(0)
  next: DeepView<MixedLinkD> | null = null

  get label(): string {
    return '2'
  }
}

export class MixedLinkD {
  tags = new Set(['3'])
  m = new Map([['k', 3]])
  at = new Date(0)
  next: Readonly<MixedLinkE> | null = null

  get label(): string {
    return '3'
  }
}

export class MixedLinkE {
  tags = new Set(['4'])
  m = new Map([['k', 4]])
  at = new Date(0)
  next: Partial<MixedLinkF> | null = null

  get label(): string {
    return '4'
  }
}

export class MixedLinkF {
  tags = new Set(['5'])
  m = new Map([['k', 5]])
  at = new Date(0)
  next: DeepView<MixedLinkG> | null = null

  get label(): string {
    return '5'
  }
}

export class MixedLinkG {
  tags = new Set(['6'])
  m = new Map([['k', 6]])
  at = new Date(0)
  next: Readonly<MixedLinkH> | null = null

  get label(): string {
    return '6'
  }
}

export class MixedLinkH {
  tags = new Set(['7'])
  m = new Map([['k', 7]])
  at = new Date(0)
  next: Partial<MixedLinkI> | null = null

  get label(): string {
    return '7'
  }
}

export class MixedLinkI {
  tags = new Set(['8'])
  m = new Map([['k', 8]])
  at = new Date(0)
  next: DeepView<MixedLinkJ> | null = null

  get label(): string {
    return '8'
  }
}

export class MixedLinkJ {
  tags = new Set(['9'])
  m = new Map([['k', 9]])
  at = new Date(0)
  next: Readonly<MixedLinkK> | null = null

  get label(): string {
    return '9'
  }
}

export class MixedLinkK {
  tags = new Set(['10'])
  m = new Map([['k', 10]])
  at = new Date(0)
  next: Partial<MixedLinkL> | null = null

  get label(): string {
    return '10'
  }
}

export class MixedLinkL {
  tags = new Set(['11'])
  m = new Map([['k', 11]])
  at = new Date(0)
  next: DeepView<MixedLinkM> | null = null

  get label(): string {
    return '11'
  }
}

export class MixedLinkM {
  tags = new Set(['12'])
  m = new Map([['k', 12]])
  at = new Date(0)
  next: Readonly<MixedLinkN> | null = null

  get label(): string {
    return '12'
  }
}

export class MixedLinkN {
  tags = new Set(['13'])
  m = new Map([['k', 13]])
  at = new Date(0)
  next: Partial<MixedLinkO> | null = null

  get label(): string {
    return '13'
  }
}

export class MixedLinkO {
  tags = new Set(['14'])
  m = new Map([['k', 14]])
  at = new Date(0)
  next: DeepView<MixedLinkP> | null = null

  get label(): string {
    return '14'
  }
}

export class MixedLinkP {
  tags = new Set(['15'])
  m = new Map([['k', 15]])
  at = new Date(0)
  next: null = null

  get label(): string {
    return '15'
  }
}

export class LongerLinkAA {
  tags = new Set(['0'])
  m = new Map([['k', 0]])
  at = new Date(0)
  next: DeepView<LongerLinkAB> | null = null

  get label(): string {
    return '0'
  }
}

export class LongerLinkAB {
  tags = new Set(['1'])
  m = new Map([['k', 1]])
  at = new Date(0)
  next: DeepView<LongerLinkAC> | null = null

  get label(): string {
    return '1'
  }
}

export class LongerLinkAC {
  tags = new Set(['2'])
  m = new Map([['k', 2]])
  at = new Date(0)
  next: DeepView<LongerLinkAD> | null = null

  get label(): string {
    return '2'
  }
}

export class LongerLinkAD {
  tags = new Set(['3'])
  m = new Map([['k', 3]])
  at = new Date(0)
  next: DeepView<LongerLinkAE> | null = null

  get label(): string {
    return '3'
  }
}

export class LongerLinkAE {
  tags = new Set(['4'])
  m = new Map([['k', 4]])
  at = new Date(0)
  next: DeepView<LongerLinkAF> | null = null

  get label(): string {
    return '4'
  }
}

export class LongerLinkAF {
  tags = new Set(['5'])
  m = new Map([['k', 5]])
  at = new Date(0)
  next: DeepView<LongerLinkAG> | null = null

  get label(): string {
    return '5'
  }
}

export class LongerLinkAG {
  tags = new Set(['6'])
  m = new Map([['k', 6]])
  at = new Date(0)
  next: DeepView<LongerLinkAH> | null = null

  get label(): string {
    return '6'
  }
}

export class LongerLinkAH {
  tags = new Set(['7'])
  m = new Map([['k', 7]])
  at = new Date(0)
  next: DeepView<LongerLinkAI> | null = null

  get label(): string {
    return '7'
  }
}

export class LongerLinkAI {
  tags = new Set(['8'])
  m = new Map([['k', 8]])
  at = new Date(0)
  next: DeepView<LongerLinkAJ> | null = null

  get label(): string {
    return '8'
  }
}

export class LongerLinkAJ {
  tags = new Set(['9'])
  m = new Map([['k', 9]])
  at = new Date(0)
  next: DeepView<LongerLinkAK> | null = null

  get label(): string {
    return '9'
  }
}

export class LongerLinkAK {
  tags = new Set(['10'])
  m = new Map([['k', 10]])
  at = new Date(0)
  next: DeepView<LongerLinkAL> | null = null

  get label(): string {
    return '10'
  }
}

export class LongerLinkAL {
  tags = new Set(['11'])
  m = new Map([['k', 11]])
  at = new Date(0)
  next: DeepView<LongerLinkAM> | null = null

  get label(): string {
    return '11'
  }
}

export class LongerLinkAM {
  tags = new Set(['12'])
  m = new Map([['k', 12]])
  at = new Date(0)
  next: DeepView<LongerLinkAN> | null = null

  get label(): string {
    return '12'
  }
}

export class LongerLinkAN {
  tags = new Set(['13'])
  m = new Map([['k', 13]])
  at = new Date(0)
  next: DeepView<LongerLinkAO> | null = null

  get label(): string {
    return '13'
  }
}

export class LongerLinkAO {
  tags = new Set(['14'])
  m = new Map([['k', 14]])
  at = new Date(0)
  next: DeepView<LongerLinkAP> | null = null

  get label(): string {
    return '14'
  }
}

export class LongerLinkAP {
  tags = new Set(['15'])
  m = new Map([['k', 15]])
  at = new Date(0)
  next: DeepView<LongerLinkAQ> | null = null

  get label(): string {
    return '15'
  }
}

export class LongerLinkAQ {
  tags = new Set(['16'])
  m = new Map([['k', 16]])
  at = new Date(0)
  next: DeepView<LongerLinkAR> | null = null

  get label(): string {
    return '16'
  }
}

export class LongerLinkAR {
  tags = new Set(['17'])
  m = new Map([['k', 17]])
  at = new Date(0)
  next: DeepView<LongerLinkAS> | null = null

  get label(): string {
    return '17'
  }
}

export class LongerLinkAS {
  tags = new Set(['18'])
  m = new Map([['k', 18]])
  at = new Date(0)
  next: DeepView<LongerLinkAT> | null = null

  get label(): string {
    return '18'
  }
}

export class LongerLinkAT {
  tags = new Set(['19'])
  m = new Map([['k', 19]])
  at = new Date(0)
  next: DeepView<LongerLinkAU> | null = null

  get label(): string {
    return '19'
  }
}

export class LongerLinkAU {
  tags = new Set(['20'])
  m = new Map([['k', 20]])
  at = new Date(0)
  next: DeepView<LongerLinkAV> | null = null

  get label(): string {
    return '20'
  }
}

export class LongerLinkAV {
  tags = new Set(['21'])
  m = new Map([['k', 21]])
  at = new Date(0)
  next: DeepView<LongerLinkAW> | null = null

  get label(): string {
    return '21'
  }
}

export class LongerLinkAW {
  tags = new Set(['22'])
  m = new Map([['k', 22]])
  at = new Date(0)
  next: DeepView<LongerLinkAX> | null = null

  get label(): string {
    return '22'
  }
}

export class LongerLinkAX {
  tags = new Set(['23'])
  m = new Map([['k', 23]])
  at = new Date(0)
  next: DeepView<LongerLinkAY> | null = null

  get label(): string {
    return '23'
  }
}

export class LongerLinkAY {
  tags = new Set(['24'])
  m = new Map([['k', 24]])
  at = new Date(0)
  next: DeepView<LongerLinkAZ> | null = null

  get label(): string {
    return '24'
  }
}

export class LongerLinkAZ {
  tags = new Set(['25'])
  m = new Map([['k', 25]])
  at = new Date(0)
  next: DeepView<LongerLinkBA> | null = null

  get label(): string {
    return '25'
  }
}

export class LongerLinkBA {
  tags = new Set(['26'])
  m = new Map([['k', 26]])
  at = new Date(0)
  next: DeepView<LongerLinkBB> | null = null

  get label(): string {
    return '26'
  }
}

export class LongerLinkBB {
  tags = new Set(['27'])
  m = new Map([['k', 27]])
  at = new Date(0)
  next: DeepView<LongerLinkBC> | null = null

  get label(): string {
    return '27'
  }
}

export class LongerLinkBC {
  tags = new Set(['28'])
  m = new Map([['k', 28]])
  at = new Date(0)
  next: DeepView<LongerLinkBD> | null = null

  get label(): string {
    return '28'
  }
}

export class LongerLinkBD {
  tags = new Set(['29'])
  m = new Map([['k', 29]])
  at = new Date(0)
  next: DeepView<LongerLinkBE> | null = null

  get label(): string {
    return '29'
  }
}

export class LongerLinkBE {
  tags = new Set(['30'])
  m = new Map([['k', 30]])
  at = new Date(0)
  next: DeepView<LongerLinkBF> | null = null

  get label(): string {
    return '30'
  }
}

export class LongerLinkBF {
  tags = new Set(['31'])
  m = new Map([['k', 31]])
  at = new Date(0)
  next: null = null

  get label(): string {
    return '31'
  }
}

export const shortDeepChain = {
  chain: os.handler((): { view: DeepView<ShortLinkA> } => ({ view: new ShortLinkA() })),
}

export const longDeepChain = {
  chain: os.handler((): { view: DeepView<LongLinkA> } => ({ view: new LongLinkA() })),
}

export const mixedDeepChain = {
  chain: os.handler((): { view: DeepView<MixedLinkA> } => ({ view: new MixedLinkA() })),
}

/** Twice as long, with instances along the chain, also as the root */
export const longerDeepChain = {
  chain: os.handler((): { view: DeepView<LongerLinkAA> } => {
    const next = new LongerLinkAB()
    next.next = new LongerLinkAC()
    const view = new LongerLinkAA()
    view.next = next
    return { view }
  }),
  root: os.handler((): DeepView<LongerLinkAA> => {
    const view = new LongerLinkAA()
    view.next = new LongerLinkAB()
    return view
  }),
}
