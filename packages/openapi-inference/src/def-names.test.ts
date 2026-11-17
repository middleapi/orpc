import type { TypeScriptProject } from './project'
import { openTypeScriptProject } from './project'
import { TypeToJsonSchemaConverter } from './type-converter'

const FIXTURE = new URL('../tests/fixtures/components-def-names/src/names.ts', import.meta.url)

describe('def names', () => {
  let project: TypeScriptProject

  // the names of the defs a type is converted with, and the def its root refers to
  const convert = (name: string, defs: 'named' | 'recursive' = 'named') => {
    const converter = new TypeToJsonSchemaConverter(project.checker, project.program, { defs })
    const [schema] = converter.convert(project.getExportType(name).type) as [any, boolean]
    return schema
  }

  beforeAll(() => {
    project = openTypeScriptProject({ file: FIXTURE })
  })

  afterAll(() => {
    project.close()
  })

  it('fixture has no type errors', () => {
    expect(project.program.getSemanticDiagnostics(project.sourceFile.fileName)).toEqual([])
  })

  it('names an instantiation over a readonly array of object literals by their keys', () => {
    const schema = convert('ReadonlyRows')

    expect(schema.$defs.ReadonlyRows.properties.page).toEqual({
      $ref: '#/$defs/Page_readonly_with-idArray',
    })
  })

  it('names a type whose name is only underscores as a recursive type', () => {
    const schema = convert('Underscored')

    expect(schema.$defs.Underscored.properties.value).toEqual({ $ref: '#/$defs/Recursive' })
    expect(schema.$defs.Recursive).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    })
  })

  it('names an anonymous class after the directory of its index file, not a file name starting with a digit', () => {
    const schema = convert('DefaultExports')

    expect(schema.$defs.DefaultExports.properties).toEqual({
      widget: { $ref: '#/$defs/Widget' },
      twoFactor: { $ref: '#/$defs/default' },
    })
    expect(schema.$defs.Widget.properties).toEqual({ label: { type: 'string' } })
    expect(schema.$defs.default.properties).toEqual({ code: { type: 'string' } })
  })

  it('names a class expression in a cycle after its variable with recursive defs', () => {
    const schema = convert('Chains', 'recursive')

    expect(schema.properties.chain).toEqual({ $ref: '#/$defs/Chain' })
    expect(schema.$defs).toEqual({
      Chain: {
        type: 'object',
        properties: { value: { type: 'number' }, next: { $ref: '#/$defs/Chain' } },
        required: ['value'],
      },
    })
  })

  it('names a recursive instantiation over an inferred type by its keys with recursive defs', () => {
    const schema = convert('Inferred', 'recursive')

    expect(schema.properties.node).toEqual({ $ref: '#/$defs/Node_with-a' })
    expect(Object.keys(schema.$defs)).toEqual(['Node_with-a'])
  })

  it('names a cycle after the alias without type arguments written for it', () => {
    const schema = convert('Where')

    expect(schema.$defs.Where.properties.author).toEqual({ $ref: '#/$defs/FilterOrWhere' })
    expect(Object.keys(schema.$defs).toSorted()).toEqual(['FilterOrWhere', 'Where'])
  })
})
