import { compareSequentialIds } from '@orpc/shared'

/**
 * Compare two redis stream ids
 * Returns:
 *  - negative if `a` < `b`
 *  - positive if `a` > `b`
 *  - 0 if equal
 */
export function compareRedisStreamIds(a: string, b: string): number {
  const [timeA, seqA] = a.split('-')
  const [timeB, seqB] = b.split('-')

  if (timeA === undefined || timeB === undefined || seqA === undefined || seqB === undefined) {
    throw new TypeError('Invalid redis stream id format')
  }

  return timeA !== timeB
    ? compareSequentialIds(timeA, timeB)
    : compareSequentialIds(seqA, seqB)
}
