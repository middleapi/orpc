/**
 * The current unix time in seconds.
 */
export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
