import type { TypeScriptProject } from './project'
import { openTypeScriptProject } from './project'
import { TypeToJsonSchemaConverter } from './type-converter'

const FIXTURE = new URL('../tests/fixtures/generator-types/src/queries.ts', import.meta.url)

describe('typeQueries', () => {
  let project: TypeScriptProject
  let converter: TypeToJsonSchemaConverter

  const convert = (name: string) => {
    const { type, symbol } = project.getExportType(name)
    converter.readAliases(symbol.declarations)
    return converter.convert(type)
  }

  beforeAll(() => {
    project = openTypeScriptProject({ file: FIXTURE })
    converter = new TypeToJsonSchemaConverter(project.checker, project.program)
  })

  afterAll(() => {
    project.close()
  })

  it('fixture has no type errors', () => {
    expect(project.program.getSemanticDiagnostics(project.sourceFile.fileName)).toEqual([])
  })

  it('reads a view over two interfaces declaring the same properties through a cycle', () => {
    expect(convert('TwinsView')).toEqual([
      {
        $ref: '#/$defs/TwinsView',
        $defs: {
          TwinsView: {
            type: 'object',
            properties: {
              child: {
                type: 'object',
                properties: { twin: { $ref: '#/$defs/TwinsView' } },
                required: ['twin'],
              },
              v: { type: 'number' },
            },
            required: ['child', 'v'],
          },
        },
      },
      false,
    ])
  })

  it('reads a view over an instance of a class without a name', () => {
    expect(convert('AnonymousView')).toEqual([
      {
        $ref: '#/$defs/AnonymousView',
        $defs: {
          AnonymousView: {
            type: 'object',
            properties: { label: { type: 'string' }, count: { type: 'number' } },
            required: ['label', 'count'],
            description: 'A view over an instance of a class without a name',
          },
        },
      },
      false,
    ])
  })

  it('reads a view widening a bigint literal to its primitive', () => {
    expect(convert('WidenedBigInt')).toEqual([
      {
        $ref: '#/$defs/Widened_with-n-s',
        $defs: {
          'Widened_with-n-s': {
            type: 'object',
            properties: {
              n: { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' },
              s: { type: 'string', const: 'a' },
            },
            required: ['n', 's'],
            description: 'A view widening a bigint literal to its primitive',
          },
        },
      },
      false,
    ])
  })

  it('compares a view of a parenthesized mapped type value by value', () => {
    expect(convert('ParenthesizedHolder')).toEqual([
      {
        $ref: '#/$defs/ParenthesizedView_Holder',
        $defs: {
          ParenthesizedView_Holder: {
            type: 'object',
            properties: { inner: { $ref: '#/$defs/ParenthesizedView_Named' } },
            required: ['inner'],
            description:
              'A deep view whose mapped type is written in parentheses, so its alias declares no mapped type',
          },
          ParenthesizedView_Named: {
            type: 'object',
            properties: { x: { type: 'string' } },
            required: ['x'],
            description:
              'A deep view whose mapped type is written in parentheses, so its alias declares no mapped type',
          },
        },
      },
      false,
    ])
  })

  it('reads the aliases of nested namespaces, beside a shorthand ambient module', () => {
    expect(convert('NestedItem')).toEqual([
      {
        $ref: '#/$defs/Item',
        $defs: {
          Item: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      },
      false,
    ])
  })

  it('drops the pairs found kept assuming an enclosing pair, once a later value shows it is not kept', () => {
    const ring = convert('RingView')[0] as any
    const view = ring.$defs[ring.$ref.slice('#/$defs/'.length)]

    expect(view.properties.v).toEqual({ type: 'string' })
    // the numbers of the ring are sent as strings
    expect(JSON.stringify(ring)).toContain('"n":{"type":"string"}')
    expect(JSON.stringify(ring)).not.toContain('"type":"number"')
  })
})
