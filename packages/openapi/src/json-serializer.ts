import { isPlainObject } from '@orpc/shared'

export class JSONSerializer {
  serialize(payload: unknown): unknown {
    if (payload instanceof Set)
      return this.serialize([...payload])
    if (payload instanceof Map)
      return this.serialize([...payload.entries()])
    if (Array.isArray(payload)) {
      return payload.map(v => (v === undefined ? 'undefined' : this.serialize(v)))
    }
    if (Number.isNaN(payload))
      return 'NaN'
    if (typeof payload === 'bigint')
      return payload.toString()
    if (payload instanceof Date && Number.isNaN(payload.getTime())) {
      return 'Invalid Date'
    }
    if (payload instanceof RegExp)
      return payload.toString()
    if (payload instanceof URL)
      return payload.toString()
    if (!isPlainObject(payload))
      return payload
    return Object.keys(payload).reduce(
      (carry, key) => {
        const val = payload[key]
        carry[key] = this.serialize(val)
        return carry
      },
      {} as Record<string, unknown>,
    )
  }
}

export type PublicJSONSerializer = Pick<JSONSerializer, keyof JSONSerializer>
