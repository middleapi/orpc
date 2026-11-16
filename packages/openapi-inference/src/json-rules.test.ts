import { getClassType, getWrittenToJSONResultTypes, isClassView } from './json-rules'
import type { TypeScriptProject } from './project'
import { openTypeScriptProject } from './project'
import { TypeToJsonSchemaConverter } from './type-converter'
import { TypeQueries } from './type-queries'

const TO_JSON = new URL('../tests/fixtures/schemas/src/to-json.ts', import.meta.url)
const LIBRARY = new URL('../tests/fixtures/schemas/src/library.ts', import.meta.url)

describe('toJSON calls', () => {
  let project: TypeScriptProject
  let types: TypeQueries

  const typeOf = (name: string) => project.getExportType(name).type

  beforeAll(() => {
    project = openTypeScriptProject({ file: TO_JSON })
    types = new TypeQueries(project.checker, project.program)
  })

  afterAll(() => {
    project.close()
  })

  it('fixture has no type errors', () => {
    expect(project.program.getSemanticDiagnostics(project.sourceFile.fileName)).toEqual([])
  })

  it('writes what each `toJSON` returns, of any parameters and `this`', () => {
    const [output] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
      typeOf('ToJSONs'),
    ) as [any, boolean]
    const written = Object.fromEntries(
      Object.entries(output.$defs.ToJSONs.properties).map(([key, value]: [string, any]) => [
        key,
        value.type,
      ]),
    )

    expect(written).toEqual({
      // `JSON.stringify` passes a string key to a `toJSON` of a number one
      numberKey: 'number',
      // and calls a `toJSON` for values of another type
      otherThis: 'string',
      ownThis: 'boolean',
      rest: 'number',
      keyAndOptions: 'string',
    })

    // an input is the instance or a plain object with its fields
    const [input] = new TypeToJsonSchemaConverter(project.checker, project.program, {
      direction: 'input',
    }).convert(typeOf('ToJSONs')) as [any, boolean]

    expect(input.$defs.OwnThis.anyOf).toEqual([
      { type: 'boolean' },
      { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] },
    ])
    expect(input.$defs.KeyAndOptions.anyOf).toEqual([{ type: 'string' }, { type: 'object' }])
  })

  it('finds the class of a type parameter constrained to it, which a value of it may view', () => {
    const money = typeOf('Money')
    const ofMoney = typeOf('OfMoney')

    expect(getClassType(types, ofMoney)?.id).toBe(money.id)
    expect(isClassView(types, ofMoney)).toBe(true)
  })

  it('takes an intersection with a class writing it by its `toJSON` as no view', () => {
    const branded = typeOf('BrandedMoney')

    expect(getClassType(types, branded)?.id).toBe(typeOf('Money').id)
    expect(isClassView(types, branded)).toBe(false)
  })
})

describe('library classes', () => {
  it('follows a few views of the interface a library constructor creates, not more', () => {
    const project = openTypeScriptProject({ file: LIBRARY })

    try {
      const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
        project.getExportType('LibraryValues').type,
      ) as [any, boolean]
      const { near, far } = schema.$defs.LibraryValues.properties

      // a library class is written by `JSON.stringify`, which writes a `Set` as `{}`
      expect(near.properties.tags).toEqual({ type: 'object' })
      expect(far.properties.tags).toEqual(
        expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
      )
    } finally {
      project.close()
    }
  })

  it('takes an interface as no class when the compiler gives no type of its constructor', () => {
    const project = openTypeScriptProject({ file: LIBRARY })

    try {
      const getTypeOfSymbol = project.checker.getTypeOfSymbol.bind(project.checker)
      vi.spyOn(project.checker, 'getTypeOfSymbol').mockImplementation(((symbol: any) =>
        !Array.isArray(symbol) && symbol.name === 'Near'
          ? undefined
          : getTypeOfSymbol(symbol)) as any)

      const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
        project.getExportType('LibraryValues').type,
      ) as [any, boolean]

      expect(schema.$defs.LibraryValues.properties.near.properties.tags).toEqual(
        expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
      )
    } finally {
      vi.restoreAllMocks()
      project.close()
    }
  })
})

describe('toJSON without return types', () => {
  it('takes a `toJSON` the compiler gives no return type of as returning nothing written', () => {
    const project = openTypeScriptProject({ file: TO_JSON })

    try {
      const money = project.getExportType('Money').type

      expect(
        getWrittenToJSONResultTypes(new TypeQueries(project.checker, project.program), money).map(
          (type) => project.checker.typeToString(type),
        ),
      ).toEqual(['string'])

      vi.spyOn(project.checker, 'getReturnTypeOfSignature').mockReturnValue(undefined)

      expect(
        getWrittenToJSONResultTypes(new TypeQueries(project.checker, project.program), money),
      ).toEqual([])
    } finally {
      vi.restoreAllMocks()
      project.close()
    }
  })
})
