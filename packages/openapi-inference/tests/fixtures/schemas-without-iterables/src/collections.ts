/** Interfaces extending collections, which have no iterators without the iterable library */
export interface Tags extends Set<string> {}

export interface Counts extends Map<string, number> {}

export interface Collections {
  tags: Tags
  counts: Counts
}
