// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

export class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

/** Sent in a parameter as what `toString` returns */
export class Cents {
  constructor(public cents: number) {}

  toString(): string {
    return `${this.cents}c`
  }
}

const query = (path: `/${string}`) => os.route({ method: 'GET', path })

/** Procedures documented as the values they are sent or written as */
export const roundEightyThree = {
  // class instances in a query are sent as `String(value)`, plain objects by their fields
  classQuery: query('/class-query')
    .input(type<{ p: Point; m: Cents; e?: Error; list?: Point[] }>())
    .handler(() => 1),
}

/** The inputs a client sends to each procedure of `roundEightyThree` taking one */
export const roundEightyThreeInputs: Record<string, () => unknown[]> = {
  classQuery: () => [
    { p: new Point(1, 2), m: new Cents(5), e: new Error('x'), list: [new Point(1, 2)] },
    { p: { x: 1, y: 2 }, m: { cents: 5 }, e: { name: 'E', message: 'm' }, list: [{ x: 1, y: 2 }] },
  ],
}
