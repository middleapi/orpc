import { stringifyJSON } from '@orpc/shared'

export function distinctData(items: { data: unknown }[]): unknown[] {
  return items
    .map((item) => item.data)
    .filter((data, i, all) => i === 0 || stringifyJSON(data) !== stringifyJSON(all[i - 1]))
}
