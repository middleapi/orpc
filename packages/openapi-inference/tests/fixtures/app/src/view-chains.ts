import { os } from '@orpc/server'

/*
 * Chains and rings of classes whose field is a view of the next class, `Readonly<Next> | null`.
 * Each view holds an instance or a plain object, so the document must not grow quadratically.
 */

export class Chain8_1 {
  tags = new Set(['chain8_1'])
  next: Readonly<Chain8_2> | null = null

  get label(): string {
    return '1'
  }
}

export class Chain8_2 {
  tags = new Set(['chain8_2'])
  next: Readonly<Chain8_3> | null = null

  get label(): string {
    return '2'
  }
}

export class Chain8_3 {
  tags = new Set(['chain8_3'])
  next: Readonly<Chain8_4> | null = null

  get label(): string {
    return '3'
  }
}

export class Chain8_4 {
  tags = new Set(['chain8_4'])
  next: Readonly<Chain8_5> | null = null

  get label(): string {
    return '4'
  }
}

export class Chain8_5 {
  tags = new Set(['chain8_5'])
  next: Readonly<Chain8_6> | null = null

  get label(): string {
    return '5'
  }
}

export class Chain8_6 {
  tags = new Set(['chain8_6'])
  next: Readonly<Chain8_7> | null = null

  get label(): string {
    return '6'
  }
}

export class Chain8_7 {
  tags = new Set(['chain8_7'])
  next: Readonly<Chain8_8> | null = null

  get label(): string {
    return '7'
  }
}

export class Chain8_8 {
  tags = new Set(['chain8_8'])

  get label(): string {
    return '8'
  }
}

export class Ring8_1 {
  tags = new Set(['ring8_1'])
  next: Readonly<Ring8_2> | null = null

  get label(): string {
    return '1'
  }
}

export class Ring8_2 {
  tags = new Set(['ring8_2'])
  next: Readonly<Ring8_3> | null = null

  get label(): string {
    return '2'
  }
}

export class Ring8_3 {
  tags = new Set(['ring8_3'])
  next: Readonly<Ring8_4> | null = null

  get label(): string {
    return '3'
  }
}

export class Ring8_4 {
  tags = new Set(['ring8_4'])
  next: Readonly<Ring8_5> | null = null

  get label(): string {
    return '4'
  }
}

export class Ring8_5 {
  tags = new Set(['ring8_5'])
  next: Readonly<Ring8_6> | null = null

  get label(): string {
    return '5'
  }
}

export class Ring8_6 {
  tags = new Set(['ring8_6'])
  next: Readonly<Ring8_7> | null = null

  get label(): string {
    return '6'
  }
}

export class Ring8_7 {
  tags = new Set(['ring8_7'])
  next: Readonly<Ring8_8> | null = null

  get label(): string {
    return '7'
  }
}

export class Ring8_8 {
  tags = new Set(['ring8_8'])
  next: Readonly<Ring8_1> | null = null

  get label(): string {
    return '8'
  }
}

export class Chain16_1 {
  tags = new Set(['chain16_1'])
  next: Readonly<Chain16_2> | null = null

  get label(): string {
    return '1'
  }
}

export class Chain16_2 {
  tags = new Set(['chain16_2'])
  next: Readonly<Chain16_3> | null = null

  get label(): string {
    return '2'
  }
}

export class Chain16_3 {
  tags = new Set(['chain16_3'])
  next: Readonly<Chain16_4> | null = null

  get label(): string {
    return '3'
  }
}

export class Chain16_4 {
  tags = new Set(['chain16_4'])
  next: Readonly<Chain16_5> | null = null

  get label(): string {
    return '4'
  }
}

export class Chain16_5 {
  tags = new Set(['chain16_5'])
  next: Readonly<Chain16_6> | null = null

  get label(): string {
    return '5'
  }
}

export class Chain16_6 {
  tags = new Set(['chain16_6'])
  next: Readonly<Chain16_7> | null = null

  get label(): string {
    return '6'
  }
}

export class Chain16_7 {
  tags = new Set(['chain16_7'])
  next: Readonly<Chain16_8> | null = null

  get label(): string {
    return '7'
  }
}

export class Chain16_8 {
  tags = new Set(['chain16_8'])
  next: Readonly<Chain16_9> | null = null

  get label(): string {
    return '8'
  }
}

export class Chain16_9 {
  tags = new Set(['chain16_9'])
  next: Readonly<Chain16_10> | null = null

  get label(): string {
    return '9'
  }
}

export class Chain16_10 {
  tags = new Set(['chain16_10'])
  next: Readonly<Chain16_11> | null = null

  get label(): string {
    return '10'
  }
}

export class Chain16_11 {
  tags = new Set(['chain16_11'])
  next: Readonly<Chain16_12> | null = null

  get label(): string {
    return '11'
  }
}

export class Chain16_12 {
  tags = new Set(['chain16_12'])
  next: Readonly<Chain16_13> | null = null

  get label(): string {
    return '12'
  }
}

export class Chain16_13 {
  tags = new Set(['chain16_13'])
  next: Readonly<Chain16_14> | null = null

  get label(): string {
    return '13'
  }
}

export class Chain16_14 {
  tags = new Set(['chain16_14'])
  next: Readonly<Chain16_15> | null = null

  get label(): string {
    return '14'
  }
}

export class Chain16_15 {
  tags = new Set(['chain16_15'])
  next: Readonly<Chain16_16> | null = null

  get label(): string {
    return '15'
  }
}

export class Chain16_16 {
  tags = new Set(['chain16_16'])

  get label(): string {
    return '16'
  }
}

export class Ring16_1 {
  tags = new Set(['ring16_1'])
  next: Readonly<Ring16_2> | null = null

  get label(): string {
    return '1'
  }
}

export class Ring16_2 {
  tags = new Set(['ring16_2'])
  next: Readonly<Ring16_3> | null = null

  get label(): string {
    return '2'
  }
}

export class Ring16_3 {
  tags = new Set(['ring16_3'])
  next: Readonly<Ring16_4> | null = null

  get label(): string {
    return '3'
  }
}

export class Ring16_4 {
  tags = new Set(['ring16_4'])
  next: Readonly<Ring16_5> | null = null

  get label(): string {
    return '4'
  }
}

export class Ring16_5 {
  tags = new Set(['ring16_5'])
  next: Readonly<Ring16_6> | null = null

  get label(): string {
    return '5'
  }
}

export class Ring16_6 {
  tags = new Set(['ring16_6'])
  next: Readonly<Ring16_7> | null = null

  get label(): string {
    return '6'
  }
}

export class Ring16_7 {
  tags = new Set(['ring16_7'])
  next: Readonly<Ring16_8> | null = null

  get label(): string {
    return '7'
  }
}

export class Ring16_8 {
  tags = new Set(['ring16_8'])
  next: Readonly<Ring16_9> | null = null

  get label(): string {
    return '8'
  }
}

export class Ring16_9 {
  tags = new Set(['ring16_9'])
  next: Readonly<Ring16_10> | null = null

  get label(): string {
    return '9'
  }
}

export class Ring16_10 {
  tags = new Set(['ring16_10'])
  next: Readonly<Ring16_11> | null = null

  get label(): string {
    return '10'
  }
}

export class Ring16_11 {
  tags = new Set(['ring16_11'])
  next: Readonly<Ring16_12> | null = null

  get label(): string {
    return '11'
  }
}

export class Ring16_12 {
  tags = new Set(['ring16_12'])
  next: Readonly<Ring16_13> | null = null

  get label(): string {
    return '12'
  }
}

export class Ring16_13 {
  tags = new Set(['ring16_13'])
  next: Readonly<Ring16_14> | null = null

  get label(): string {
    return '13'
  }
}

export class Ring16_14 {
  tags = new Set(['ring16_14'])
  next: Readonly<Ring16_15> | null = null

  get label(): string {
    return '14'
  }
}

export class Ring16_15 {
  tags = new Set(['ring16_15'])
  next: Readonly<Ring16_16> | null = null

  get label(): string {
    return '15'
  }
}

export class Ring16_16 {
  tags = new Set(['ring16_16'])
  next: Readonly<Ring16_1> | null = null

  get label(): string {
    return '16'
  }
}

export const chain8 = {
  chain: os.handler((): { view: Readonly<Chain8_1>; instance: Chain8_1 } => {
    const first = new Chain8_1()
    // instances `JSON.stringify` writes, also the plain object inside them
    first.next = Object.assign(new Chain8_2(), {
      next: { tags: new Set(['plain']), label: 'p', next: null },
    })
    // a plain object the serializer walks
    const view = { tags: new Set(['view']), label: 'v', next: first.next }
    return { view, instance: first }
  }),
  ring: os.handler((): { view: Readonly<Ring8_1>; instance: Ring8_1 } => {
    const first = new Ring8_1()
    first.next = { tags: new Set(['plain']), label: 'p', next: null }
    return { view: { tags: new Set(['view']), label: 'v', next: first }, instance: first }
  }),
}

export const chain16 = {
  chain: os.handler((): { view: Readonly<Chain16_1>; instance: Chain16_1 } => {
    const first = new Chain16_1()
    // instances `JSON.stringify` writes, also the plain object inside them
    first.next = Object.assign(new Chain16_2(), {
      next: { tags: new Set(['plain']), label: 'p', next: null },
    })
    // a plain object the serializer walks
    const view = { tags: new Set(['view']), label: 'v', next: first.next }
    return { view, instance: first }
  }),
  ring: os.handler((): { view: Readonly<Ring16_1>; instance: Ring16_1 } => {
    const first = new Ring16_1()
    first.next = { tags: new Set(['plain']), label: 'p', next: null }
    return { view: { tags: new Set(['view']), label: 'v', next: first }, instance: first }
  }),
}
