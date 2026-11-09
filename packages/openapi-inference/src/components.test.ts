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
})
