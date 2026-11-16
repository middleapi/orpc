// a declaration file of a built package, one of whose imports the compiler finds
import type { Point } from './infinity-limits'

export interface Shelf {
  origin: Point
  inner: import('@acme/not-installed').Inner
}
