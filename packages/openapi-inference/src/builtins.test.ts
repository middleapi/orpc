import { getNodeBuffer } from './builtins'
import type { TypeScriptProject } from './project'
import { openTypeScriptProject } from './project'
import { TypeToJsonSchemaConverter } from './type-converter'
import { TypeQueries } from './type-queries'

const BUILTINS = new URL('../tests/fixtures/schemas/src/builtins.ts', import.meta.url)

describe('built-ins', () => {
  let project: TypeScriptProject

  const convert = (name: string, direction: 'input' | 'output' = 'output') =>
    new TypeToJsonSchemaConverter(project.checker, project.program, { direction }).convert(
      project.getExportType(name).type,
    ) as [any, boolean]

  beforeAll(() => {
    project = openTypeScriptProject({ file: BUILTINS })
  })

  afterAll(() => {
    project.close()
  })

  it('fixture has no type errors', () => {
    expect(project.program.getSemanticDiagnostics(project.sourceFile.fileName)).toEqual([])
  })

  it('writes a `Blob` of a class instance as `JSON.stringify` does', () => {
    expect(convert('Uploads')[0].$defs.Upload.properties.file).toEqual({ type: 'object' })
    // an input may also be a plain object sending the binary value
    expect(convert('Uploads', 'input')[0].$defs.Upload.properties.file).toEqual({
      anyOf: [{ type: 'string', contentMediaType: '*/*' }, { type: 'object' }],
    })
  })

  it('writes a view of a date `toJSON` returns by its own fields, also beside `object`', () => {
    for (const name of ['ViewOfObjectJSON', 'ObjectViewJSON']) {
      expect(convert(name)[0].$defs[name]).toEqual(expect.objectContaining({ type: 'object' }))
      expect(convert(name)[0].$defs[name]).not.toHaveProperty('properties')
    }
  })

  it('writes a view of an interface reaching a base twice as a plain object', () => {
    expect(convert('Diamonds')[0].$defs.Diamonds.properties.diamond).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, left: { type: 'string' }, right: { type: 'string' } },
      required: ['a'],
    })
  })

  it('converts chains of views and interfaces deeper than are followed', () => {
    const [schema] = convert('Chains')

    expect(schema.$defs.Chains.properties.view).toEqual(
      expect.objectContaining({ 'type': 'string', 'x-native-type': 'date' }),
    )
    // what `toJSON` of the date returns, or a plain object of the fields of the interfaces
    expect(schema.$defs.Chain0.anyOf).toEqual([
      { type: 'string' },
      {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 18 }, (_, i) => [`chain${i}`, { type: 'string' }]),
        ),
      },
    ])
  })

  it('finds the Node `Buffer` and what its `toJSON` returns', () => {
    const buffer = getNodeBuffer(new TypeQueries(project.checker, project.program))

    expect(buffer && project.checker.typeToString(buffer.buffer)).toBe('Buffer<ArrayBuffer>')
    expect(buffer?.written).toHaveLength(1)
  })
})

describe('built-ins without return types', () => {
  it('finds no Node `Buffer` when the compiler gives no return types of its methods', () => {
    const project = openTypeScriptProject({ file: BUILTINS })

    try {
      vi.spyOn(project.checker, 'getReturnTypeOfSignature').mockReturnValue(undefined)

      expect(getNodeBuffer(new TypeQueries(project.checker, project.program))).toBeUndefined()
    } finally {
      vi.restoreAllMocks()
      project.close()
    }
  })
})

describe('built-ins without iterables', () => {
  it('converts collections without iterators of any items', () => {
    const project = openTypeScriptProject({
      file: new URL(
        '../tests/fixtures/schemas-without-iterables/src/collections.ts',
        import.meta.url,
      ),
    })

    try {
      expect(project.program.getSemanticDiagnostics(project.sourceFile.fileName)).toEqual([])

      for (const direction of ['output', 'input'] as const) {
        const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program, {
          direction,
        }).convert(project.getExportType('Collections').type) as [any, boolean]

        expect(schema.$defs.Tags).toEqual(
          expect.objectContaining({ 'type': 'array', 'items': {}, 'x-native-type': 'set' }),
        )
        expect(schema.$defs.Counts).toEqual({
          'type': 'array',
          'items': {},
          'x-native-type': 'map',
        })
      }
    } finally {
      project.close()
    }
  })
})
