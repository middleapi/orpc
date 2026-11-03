import { RPCJsonSerializer } from '@orpc/client'

export class Point {
  constructor(public x: number, public y: number) {}
}

export const pointSerializer = new RPCJsonSerializer({
  handlers: {
    point: {
      condition: (value: unknown) => value instanceof Point,
      serialize: (value: Point) => [value.x, value.y],
      deserialize: ([x, y]: [number, number]) => new Point(x, y),
      isTerminal: true,
    },
  },
})
