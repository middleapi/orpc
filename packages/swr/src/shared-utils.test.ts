import { Point, pointSerializer } from '../tests/__shared__/serializer'
import { generateOperationKey } from './key'
import { SharedUtils } from './shared-utils'

describe('sharedUtils', () => {
  const utils = new SharedUtils(['test', 'path'], {})

  describe('.matcher', () => {
    it('strategy=partial', () => {
      expect(utils.matcher()([['test', 'path'], { input: { value1: 'test' } }])).toBe(true)
      expect(utils.matcher()([['test', 'path'], {}])).toBe(true)
      expect(utils.matcher()([['invalid'], { input: { value1: 'test' } }])).toBe(false)

      expect(utils.matcher({ input: { value1: true } })([['test', 'path'], { input: { value1: true, value2: true } }])).toBe(true)
      expect(utils.matcher({ input: { value1: true } })([['test', 'path'], { input: { value1: false, value2: true } }])).toBe(false)
    })

    it('strategy=exact', () => {
      expect(utils.matcher({ strategy: 'exact', input: { value1: 'test' } })([['test', 'path'], { input: { value1: 'test' } }])).toBe(true)
      expect(utils.matcher({ strategy: 'exact' })([['test', 'path'], { input: { value1: 'test' } }])).toBe(false)
      expect(utils.matcher({ strategy: 'exact', input: { value1: 'test' } })([['invalid'], { input: { value1: 'test' } }])).toBe(false)
    })

    describe.each<[string, () => unknown, () => unknown, () => unknown]>([
      ['Set', () => ({ ids: new Set([1, 2]) }), () => ({ ids: new Set([1]) }), () => ({ ids: new Set([2]) })],
      ['Map', () => ({ map: new Map([['a', 1], ['b', 2]]) }), () => ({ map: new Map([['a', 1]]) }), () => ({ map: new Map([['a', 2]]) })],
      ['BigInt', () => ({ value: 1n, other: 1 }), () => ({ value: 1n }), () => ({ value: 2n })],
      ['Date', () => ({ since: new Date('2024-01-01'), other: 1 }), () => ({ since: new Date('2024-01-01') }), () => ({ since: new Date('2024-01-02') })],
    ])('%s input', (_, create, createPartial, createDifferent) => {
      const key = generateOperationKey(['test', 'path'], { input: create() })

      it('strategy=exact matches an equal input', () => {
        expect(utils.matcher({ strategy: 'exact', input: create() })(key)).toBe(true)
        expect(utils.matcher({ strategy: 'exact', input: createPartial() })(key)).toBe(false)
        expect(utils.matcher({ strategy: 'exact', input: createDifferent() })(key)).toBe(false)
      })

      it('strategy=partial matches equal and partial inputs', () => {
        expect(utils.matcher({ input: create() })(key)).toBe(true)
        expect(utils.matcher({ input: createPartial() })(key)).toBe(true)
        expect(utils.matcher({ input: createDifferent() })(key)).toBe(false)
      })
    })

    it('does not match values that only share a JSON form', () => {
      const bigintKey = generateOperationKey(['test', 'path'], { input: { value: 1n } })
      const numberKey = generateOperationKey(['test', 'path'], { input: { value: 1 } })
      const dateKey = generateOperationKey(['test', 'path'], { input: { since: new Date('2024-01-01') } })

      expect(utils.matcher({ input: { value: 1 } })(bigintKey)).toBe(false)
      expect(utils.matcher({ input: { value: 1n } })(numberKey)).toBe(false)
      expect(utils.matcher({ strategy: 'exact', input: { value: '1' } })(bigintKey)).toBe(false)
      expect(utils.matcher({ strategy: 'exact', input: { since: '2024-01-01T00:00:00.000Z' } })(dateKey)).toBe(false)
    })

    it('uses the serializer option', () => {
      const serializerUtils = new SharedUtils<{ at: Point }>(['test', 'path'], { serializer: pointSerializer })
      const key = generateOperationKey(['test', 'path'], { serializer: pointSerializer, input: { at: new Point(1, 2) } })

      expect(serializerUtils.matcher({ strategy: 'exact', input: { at: new Point(1, 2) } })(key)).toBe(true)
      expect(serializerUtils.matcher({ strategy: 'exact', input: { at: new Point(1, 3) } })(key)).toBe(false)
    })

    it('with prefix', () => {
      const prefixedUtils = new SharedUtils(['test', 'path'], { prefix: '__prefix__' })

      expect(prefixedUtils.matcher()(['__prefix__', ['test', 'path'], { input: { value1: 'test' } }])).toBe(true)
      expect(prefixedUtils.matcher()([['test', 'path'], { input: { value1: 'test' } }])).toBe(false)
      expect(prefixedUtils.matcher()(['__invalid__', ['test', 'path'], { input: { value1: 'test' } }])).toBe(false)

      expect(prefixedUtils.matcher({ strategy: 'exact', input: { value1: 'test' } })(['__prefix__', ['test', 'path'], { input: { value1: 'test' } }])).toBe(true)
      expect(prefixedUtils.matcher({ strategy: 'exact' })(['__prefix__', ['test', 'path'], { input: { value1: 'test' } }])).toBe(false)
    })
  })
})
