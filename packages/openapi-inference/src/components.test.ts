import { mergeEquivalentComponents } from './components'

describe('mergeEquivalentComponents', () => {
  const ref = (name: string) => `#/components/schemas/${name}`
  const circle = { type: 'object', properties: { kind: { const: 'circle' } }, required: ['kind'] }
  const square = { type: 'object', properties: { kind: { const: 'square' } }, required: ['kind'] }
  const shape = (circleName: string) => ({
    oneOf: [{ $ref: ref(circleName) }, { $ref: ref('Square') }],
    discriminator: {
      propertyName: 'kind',
      mapping: { circle: ref(circleName), square: ref('Square') },
    },
  })

  it('merges components that differ by the equivalent components a discriminator maps to', () => {
    const document = {
      components: {
        schemas: {
          Circle: circle,
          Circle2: circle,
          Square: square,
          Shape: shape('Circle'),
          Shape2: shape('Circle2'),
        },
      },
    }

    mergeEquivalentComponents(document, {
      used: new Set(Object.keys(document.components.schemas)),
      numbered: new Map([
        ['Circle2', 'Circle'],
        ['Shape2', 'Shape'],
      ]),
    })

    expect(document.components.schemas).toEqual({
      Circle: circle,
      Square: square,
      Shape: shape('Circle'),
    })
  })

  it('rewrites the refs of a discriminator to a renamed component', () => {
    const document = {
      components: { schemas: { Circle2: circle, Square: square, Shape: shape('Circle2') } },
      paths: { '/shape': { get: { responses: { 200: { schema: shape('Circle2') } } } } },
    }

    mergeEquivalentComponents(document, {
      used: new Set(Object.keys(document.components.schemas)),
      numbered: new Map([['Circle2', 'Circle']]),
    })

    expect(document).toEqual({
      components: { schemas: { Circle: circle, Square: square, Shape: shape('Circle') } },
      paths: { '/shape': { get: { responses: { 200: { schema: shape('Circle') } } } } },
    })
  })

  it('merges the components of a type in two modes described the same, by the shorter name', () => {
    const point = { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] }
    const document = {
      components: {
        schemas: {
          PointJson: point,
          Point: point,
          Holder: {
            type: 'object',
            properties: { point: { $ref: ref('PointJson') } },
            required: ['point'],
          },
          Other: { ...point, description: 'Other' },
          OtherJson: point,
        },
      },
    }

    mergeEquivalentComponents(document, {
      used: new Set(Object.keys(document.components.schemas)),
      numbered: new Map(),
      modes: new Map([
        ['PointJson', 'Point'],
        ['OtherJson', 'Other'],
      ]),
    })

    // only the same values are merged
    expect(document.components.schemas).toEqual({
      Point: point,
      Holder: {
        type: 'object',
        properties: { point: { $ref: ref('Point') } },
        required: ['point'],
      },
      Other: { ...point, description: 'Other' },
      OtherJson: point,
    })
  })

  it('gives the name of a def named after an alias its type lost to a declared type numbered after it', () => {
    const row = { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
    const user = { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }
    const document = {
      components: { schemas: { User: row, User2: user } },
      paths: { '/rows': { items: { $ref: ref('User') } }, '/users': { $ref: ref('User2') } },
    }

    mergeEquivalentComponents(document, {
      used: new Set(['User', 'User2']),
      numbered: new Map([['User2', 'User']]),
      aliased: new Set(['User']),
    })

    expect(document).toEqual({
      components: { schemas: { User: user, User2: row } },
      paths: { '/rows': { items: { $ref: ref('User2') } }, '/users': { $ref: ref('User') } },
    })
  })

  it('keeps the name of a declared type a def named after an alias was numbered after', () => {
    const row = { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
    const user = { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }
    const document = { components: { schemas: { User: user, User2: row } } }

    mergeEquivalentComponents(document, {
      used: new Set(['User', 'User2']),
      numbered: new Map([['User2', 'User']]),
      aliased: new Set(['User2']),
    })

    expect(document.components.schemas).toEqual({ User: user, User2: row })
  })
})
