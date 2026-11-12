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

  it('merges and renames the components the stock generator gave a def in a direction with it', () => {
    const node = (self: string) => ({
      type: 'object',
      properties: { s: { type: 'string' }, next: { $ref: ref(self) } },
    })
    const nodeInput = (self: string) => ({
      type: 'object',
      properties: { s: { type: 'object' }, next: { $ref: ref(self) } },
    })
    const document = {
      components: {
        schemas: {
          Node: node('Node'),
          Node2: node('Node2'),
          NodeInput: nodeInput('NodeInput'),
          Node2Input: nodeInput('Node2Input'),
        },
      },
      paths: { '/in': { schema: { $ref: ref('Node2Input') } } },
    }

    mergeEquivalentComponents(document, {
      used: new Set(['Node', 'Node2']),
      numbered: new Map([['Node2', 'Node']]),
    })

    expect(document).toEqual({
      components: { schemas: { Node: node('Node'), NodeInput: nodeInput('NodeInput') } },
      paths: { '/in': { schema: { $ref: ref('NodeInput') } } },
    })

    // a def renamed takes its sibling along
    const row = { type: 'object', properties: { id: { type: 'number' } } }
    const renamed = {
      components: {
        schemas: {
          User: row,
          User2: { ...row, description: 'declared' },
          User2Input: nodeInput('User2Input'),
        },
      },
      paths: { '/in': { schema: { $ref: ref('User2Input') } } },
    }

    mergeEquivalentComponents(renamed, {
      used: new Set(['User', 'User2']),
      numbered: new Map([['User2', 'User']]),
      aliased: new Set(['User']),
    })

    expect(renamed).toEqual({
      components: {
        schemas: {
          User2: row,
          User: { ...row, description: 'declared' },
          UserInput: nodeInput('UserInput'),
        },
      },
      paths: { '/in': { schema: { $ref: ref('UserInput') } } },
    })
  })

  it('leaves refs in data as they are written', () => {
    const role = { type: 'string', enum: ['admin'] }
    const stored = {
      type: 'object',
      properties: { schema: { examples: [{ $ref: ref('RoleParam') }] } },
    }
    const document = {
      components: { schemas: { RoleParam: role, Stored: stored } },
      paths: {
        '/list': {
          schema: { $ref: ref('RoleParam') },
          example: { $ref: ref('RoleParam') },
          examples: { a: { value: { $ref: ref('RoleParam') } } },
        },
      },
    }

    mergeEquivalentComponents(document, {
      used: new Set(['RoleParam', 'Stored']),
      numbered: new Map([['RoleParam', 'Role']]),
      parameters: new Set(['RoleParam']),
    })

    expect(document).toEqual({
      components: { schemas: { Role: role, Stored: stored } },
      paths: {
        '/list': {
          schema: { $ref: ref('Role') },
          example: { $ref: ref('RoleParam') },
          examples: { a: { value: { $ref: ref('RoleParam') } } },
        },
      },
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

  it('merges the components of defs whose names the stock generator made valid', () => {
    const role = { type: 'string', enum: ['admin', 'member'] }
    const names = {
      used: new Set(['$RoleParam', '$Role']),
      numbered: new Map([['$RoleParam', '$Role']]),
      modes: new Map([['$RoleParam', '$Role']]),
      parameters: new Set(['$RoleParam']),
    }
    const plain = {
      components: { schemas: { _RoleParam: role, _Role: role } },
      paths: { '/list': { schema: { $ref: ref('_RoleParam') } } },
    }

    mergeEquivalentComponents(plain, names)

    expect(plain).toEqual({
      components: { schemas: { _Role: role } },
      paths: { '/list': { schema: { $ref: ref('_Role') } } },
    })

    // `componentName` returned `Acme $RoleParam` and `Acme $Role`
    const renamed = {
      components: { schemas: { Acme__RoleParam: role, Acme__Role: role } },
      paths: { '/list': { schema: { $ref: ref('Acme__RoleParam') } } },
    }

    mergeEquivalentComponents(renamed, names, {
      defNames: new Map([
        ['Acme $RoleParam', '$RoleParam'],
        ['Acme $Role', '$Role'],
      ]),
      rename: false,
    })

    expect(renamed).toEqual({
      components: { schemas: { Acme__Role: role } },
      paths: { '/list': { schema: { $ref: ref('Acme__Role') } } },
    })
  })

  it('gives the name of a def named after an alias its type lost to a declared type numbered after it', () => {
    const row = { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
    const user = { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }
    const document = {
      components: { schemas: { User: row, User2: user } },
      paths: {
        '/rows': { schema: { items: { $ref: ref('User') } } },
        '/users': { schema: { $ref: ref('User2') } },
      },
    }

    mergeEquivalentComponents(document, {
      used: new Set(['User', 'User2']),
      numbered: new Map([['User2', 'User']]),
      aliased: new Set(['User']),
    })

    expect(document).toEqual({
      components: { schemas: { User: user, User2: row } },
      paths: {
        '/rows': { schema: { items: { $ref: ref('User2') } } },
        '/users': { schema: { $ref: ref('User') } },
      },
    })
  })

  it('keeps the name of a component of base a def named after an alias has', () => {
    const base = { type: 'string', description: 'user-defined' }
    const row = { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
    const user = { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }
    // the stock generator gives the def `User` a name of its direction, as `base` has `User`
    const document = {
      components: { schemas: { User: base, UserOutput: row, User2: user } },
      paths: {
        '/legacy': { schema: { $ref: ref('User') } },
        '/rows': { schema: { items: { $ref: ref('UserOutput') } } },
      },
    }

    mergeEquivalentComponents(
      document,
      {
        used: new Set(['User', 'User2']),
        numbered: new Map([['User2', 'User']]),
        aliased: new Set(['User']),
      },
      { reserved: new Set(['User']) },
    )

    expect(document).toEqual({
      components: { schemas: { User: base, User3: row, User2: user } },
      paths: {
        '/legacy': { schema: { $ref: ref('User') } },
        '/rows': { schema: { items: { $ref: ref('User3') } } },
      },
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
