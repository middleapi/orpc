import type { TypeScriptProject } from './project.ts'
import { openTypeScriptProject } from './project.ts'
import { TypeScriptTypeResolutionError, TypeToJsonSchemaConverter } from './type-converter.ts'

const FIXTURE = new URL('../tests/fixtures/types/src/types.ts', import.meta.url)

describe('typeToJsonSchemaConverter', () => {
  let project: TypeScriptProject
  let converter: TypeToJsonSchemaConverter

  const convert = (name: string) => converter.convert(project.getExportType(name).type)

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

  it('primitives', () => {
    expect(convert('Str')).toEqual([{ type: 'string' }, false])
    expect(convert('Num')).toEqual([{ type: 'number' }, false])
    expect(convert('Bool')).toEqual([{ type: 'boolean' }, false])
    expect(convert('Big')).toEqual([
      { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' },
      false,
    ])
    expect(convert('Null')).toEqual([{ type: 'null' }, false])
    expect(convert('Undef')).toEqual([{}, true])
    expect(convert('Unknown')).toEqual([{}, true])
    expect(convert('Any')).toEqual([{}, true])
    expect(convert('Never')).toEqual([{ not: {} }, false])
    expect(convert('Obj')).toEqual([{ type: 'object' }, false])
    expect(convert('Sym')).toEqual([{}, false])
  })

  it('literals', () => {
    expect(convert('StrLit')).toEqual([{ type: 'string', const: 'a' }, false])
    expect(convert('NumLit')).toEqual([{ type: 'number', const: -1.5 }, false])
    expect(convert('BoolLit')).toEqual([{ type: 'boolean', const: true }, false])
    expect(convert('BigLit')).toEqual([
      { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint', 'const': '10' },
      false,
    ])
    expect(convert('StrUnion')).toEqual([
      { $ref: '#/$defs/StrUnion', $defs: { StrUnion: { type: 'string', enum: ['a', 'b', 'c'] } } },
      false,
    ])
    expect(convert('NumUnion')).toEqual([
      { $ref: '#/$defs/NumUnion', $defs: { NumUnion: { type: 'number', enum: [1, 2, 3] } } },
      false,
    ])
    expect(convert('Mixed')).toEqual([
      {
        $ref: '#/$defs/Mixed',
        $defs: {
          Mixed: {
            anyOf: [
              { type: 'string', const: 'a' },
              { type: 'number', const: 1 },
              { type: 'boolean', const: true },
              { type: 'null' },
            ],
          },
        },
      },
      false,
    ])
    expect(convert('Nullable')).toEqual([{ anyOf: [{ type: 'string' }, { type: 'null' }] }, false])
    expect(convert('Optional')).toEqual([{ type: 'string' }, true])
    expect(convert('NullOrUndefined')).toEqual([{ type: 'null' }, true])
    expect(convert('LooseLiteral')).toEqual([{ type: 'string' }, false])
    expect(convert('StringOrLiteral')).toEqual([{ type: 'string' }, false])
  })

  it('enums', () => {
    expect(convert('Color')).toEqual([
      { $ref: '#/$defs/Color', $defs: { Color: { type: 'string', enum: ['red', 'green'] } } },
      false,
    ])
    expect(convert('Level')).toEqual([
      { $ref: '#/$defs/Level', $defs: { Level: { type: 'number', enum: [0, 10] } } },
      false,
    ])
    expect(convert('MixedEnum')).toEqual([
      {
        $ref: '#/$defs/MixedEnum',
        $defs: {
          MixedEnum: {
            anyOf: [
              { type: 'string', const: 'a' },
              { type: 'number', const: 1 },
            ],
          },
        },
      },
      false,
    ])
    expect(convert('OnlyRed')).toEqual([{ type: 'string', const: 'red' }, false])
  })

  it('objects', () => {
    expect(convert('Basic')).toEqual([
      {
        $ref: '#/$defs/Basic',
        $defs: {
          Basic: {
            type: 'object',
            properties: {
              '0': { type: 'string' },
              'required': { type: 'string', description: 'Required string' },
              'optional': { type: 'number' },
              'orUndefined': { type: 'number' },
              'orNull': { anyOf: [{ type: 'string' }, { type: 'null' }] },
              'nullish': { anyOf: [{ type: 'string' }, { type: 'null' }] },
              'ro': { type: 'boolean' },
              'quoted-key': { type: 'string' },
              'unknownValue': {},
            },
            required: ['required', 'orNull', 'ro', 'quoted-key', '0'],
          },
        },
      },
      false,
    ])
    expect(convert('Inline')).toEqual([
      {
        $ref: '#/$defs/Inline',
        $defs: {
          Inline: {
            type: 'object',
            properties: {
              a: { type: 'string' },
              nested: {
                type: 'object',
                properties: { b: { type: 'array', items: { type: 'number' } } },
                required: ['b'],
              },
            },
            required: ['a', 'nested'],
          },
        },
      },
      false,
    ])
    expect(convert('Empty')).toEqual([
      { $ref: '#/$defs/Empty', $defs: { Empty: { type: 'object' } } },
      false,
    ])
    expect(convert('EmptyRecord')).toEqual([
      {
        $ref: '#/$defs/EmptyRecord',
        $defs: { EmptyRecord: { type: 'object', additionalProperties: { not: {} } } },
      },
      false,
    ])
    expect(convert('Dict')).toEqual([
      {
        $ref: '#/$defs/Dict',
        $defs: { Dict: { type: 'object', additionalProperties: { type: 'number' } } },
      },
      false,
    ])
    expect(convert('NumDict')).toEqual([
      {
        $ref: '#/$defs/NumDict',
        $defs: { NumDict: { type: 'object', additionalProperties: { type: 'string' } } },
      },
      false,
    ])
    expect(convert('PrefixedDict')).toEqual([
      {
        $ref: '#/$defs/PrefixedDict',
        $defs: {
          PrefixedDict: { type: 'object', patternProperties: { '^x-.*$': { type: 'string' } } },
        },
      },
      false,
    ])
    expect(convert('KeyedRecord')).toEqual([
      {
        $ref: '#/$defs/KeyedRecord',
        $defs: {
          KeyedRecord: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'],
          },
        },
      },
      false,
    ])
    expect(convert('DictWithProps')).toEqual([
      {
        $ref: '#/$defs/DictWithProps',
        $defs: {
          DictWithProps: {
            type: 'object',
            properties: { known: { type: 'string' } },
            required: ['known'],
            additionalProperties: { type: 'string' },
          },
        },
      },
      false,
    ])
  })

  it('arrays and tuples', () => {
    expect(convert('Arr')).toEqual([
      { $ref: '#/$defs/Arr', $defs: { Arr: { type: 'array', items: { type: 'string' } } } },
      false,
    ])
    expect(convert('ReadonlyArr')).toEqual([
      {
        $ref: '#/$defs/ReadonlyArr',
        $defs: { ReadonlyArr: { type: 'array', items: { type: 'number' } } },
      },
      false,
    ])
    expect(convert('ArrOfUnion')).toEqual([
      {
        $ref: '#/$defs/ArrOfUnion',
        $defs: {
          ArrOfUnion: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        },
      },
      false,
    ])
    expect(convert('ArrWithUndefined')).toEqual([
      {
        $ref: '#/$defs/ArrWithUndefined',
        $defs: {
          ArrWithUndefined: {
            type: 'array',
            items: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
      false,
    ])
    expect(convert('Tuple')).toEqual([
      {
        $ref: '#/$defs/Tuple',
        $defs: {
          Tuple: {
            type: 'array',
            prefixItems: [{ type: 'string' }, { type: 'number' }],
            maxItems: 2,
            minItems: 2,
          },
        },
      },
      false,
    ])
    expect(convert('NamedTuple')).toEqual([
      {
        $ref: '#/$defs/NamedTuple',
        $defs: {
          NamedTuple: {
            type: 'array',
            prefixItems: [{ type: 'string' }, { type: 'number' }],
            maxItems: 2,
            minItems: 1,
          },
        },
      },
      false,
    ])
    expect(convert('RestTuple')).toEqual([
      {
        $ref: '#/$defs/RestTuple',
        $defs: {
          RestTuple: {
            type: 'array',
            prefixItems: [{ type: 'string' }],
            items: { type: 'boolean' },
            minItems: 1,
          },
        },
      },
      false,
    ])
    expect(convert('ReadonlyTuple')).toEqual([
      {
        $ref: '#/$defs/ReadonlyTuple',
        $defs: {
          ReadonlyTuple: {
            type: 'array',
            prefixItems: [
              { type: 'number', const: 1 },
              { type: 'number', const: 2 },
            ],
            maxItems: 2,
            minItems: 2,
          },
        },
      },
      false,
    ])
    expect(convert('EmptyTuple')).toEqual([{ type: 'array', maxItems: 0 }, false])
  })

  it('unions and intersections', () => {
    expect(convert('Shape')).toEqual([
      {
        $ref: '#/$defs/Shape',
        $defs: {
          Shape: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'circle' },
                  radius: { type: 'number' },
                },
                required: ['kind', 'radius'],
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'square' }, size: { type: 'number' } },
                required: ['kind', 'size'],
              },
            ],
          },
        },
      },
      false,
    ])
    expect(convert('Merged')).toEqual([
      {
        $ref: '#/$defs/Merged',
        $defs: {
          Merged: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            required: ['a'],
          },
        },
      },
      false,
    ])
    expect(convert('Branded')).toEqual([{ type: 'string' }, false])
    expect(convert('TaggedId')).toEqual([{ type: 'string' }, false])
    expect(convert('ObjectOrArray')).toEqual([
      {
        $ref: '#/$defs/ObjectOrArray',
        $defs: {
          ObjectOrArray: {
            anyOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            ],
          },
        },
      },
      false,
    ])
  })

  it('template literals', () => {
    expect(convert('Template')).toEqual([
      { type: 'string', pattern: '^user-[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$' },
      false,
    ])
    expect(convert('TemplateMulti')).toEqual([
      {
        anyOf: [
          { type: 'string', pattern: '^GET \\/.*$' },
          { type: 'string', pattern: '^POST \\/.*$' },
        ],
      },
      false,
    ])
    expect(convert('TemplateBool')).toEqual([
      { type: 'string', enum: ['is-false', 'is-true'] },
      false,
    ])
    expect(convert('Upper')).toEqual([{ type: 'string' }, false])
  })

  it('built-in objects', () => {
    expect(convert('Builtins')).toEqual([
      {
        $ref: '#/$defs/Builtins',
        $defs: {
          Builtins: {
            type: 'object',
            properties: {
              date: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
              url: { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' },
              big: { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' },
              set: {
                'type': 'array',
                'uniqueItems': true,
                'items': { type: 'string' },
                'x-native-type': 'set',
              },
              map: {
                'type': 'array',
                'items': {
                  type: 'array',
                  prefixItems: [{ type: 'string' }, { type: 'number' }],
                  maxItems: 2,
                  minItems: 2,
                },
                'x-native-type': 'map',
              },
              blob: { type: 'string', contentMediaType: '*/*' },
              file: { type: 'string', contentMediaType: '*/*' },
              promise: { type: 'string' },
              regexp: {},
            },
            required: ['date', 'url', 'big', 'set', 'map', 'blob', 'file', 'promise', 'regexp'],
          },
        },
      },
      false,
    ])
  })

  it('classes', () => {
    expect(convert('Point')).toEqual([
      {
        $ref: '#/$defs/Point',
        $defs: {
          Point: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              hidden: { type: 'number' },
            },
            required: ['x', 'y', 'hidden'],
          },
        },
      },
      false,
    ])
    expect(convert('Money')).toEqual([{ type: 'string' }, false])
  })

  it('generics, mapped and conditional types', () => {
    expect(convert('Box')).toEqual([
      {
        $ref: '#/$defs/Box_T',
        $defs: { Box_T: { type: 'object', properties: { value: {} }, required: ['value'] } },
      },
      false,
    ])
    expect(convert('Page')).toEqual([
      {
        $ref: '#/$defs/Page_T',
        $defs: {
          Page_T: {
            type: 'object',
            properties: { items: { type: 'array', items: {} }, total: { type: 'number' } },
            required: ['items', 'total'],
          },
        },
      },
      false,
    ])
    expect(convert('BoxOfUser')).toEqual([
      {
        $ref: '#/$defs/BoxOfUser',
        $defs: {
          BoxOfUser: {
            type: 'object',
            properties: { value: { $ref: '#/$defs/User' } },
            required: ['value'],
          },
          User: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
            description: 'A registered user',
          },
        },
      },
      false,
    ])
    expect(convert('PageOfBox')).toEqual([
      {
        $ref: '#/$defs/PageOfBox',
        $defs: {
          PageOfBox: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: '#/$defs/Box_number' } },
              total: { type: 'number' },
            },
            required: ['items', 'total'],
          },
          Box_number: {
            type: 'object',
            properties: { value: { type: 'number' } },
            required: ['value'],
          },
        },
      },
      false,
    ])
    expect(convert('PartialUser')).toEqual([
      { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
      false,
    ])
    expect(convert('PickUser')).toEqual([
      {
        $ref: '#/$defs/PickUser',
        $defs: {
          PickUser: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      },
      false,
    ])
    expect(convert('OmitUser')).toEqual([
      {
        $ref: '#/$defs/OmitUser',
        $defs: {
          OmitUser: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
      false,
    ])
    expect(convert('RequiredUser')).toEqual([
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      false,
    ])
    expect(convert('ReadonlyUser')).toEqual([
      {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      false,
    ])
    expect(convert('Getters')).toEqual([
      { $ref: '#/$defs/Getters_T', $defs: { Getters_T: { type: 'object' } } },
      false,
    ])
    expect(convert('Nullify')).toEqual([
      { $ref: '#/$defs/Nullify_T', $defs: { Nullify_T: { type: 'object' } } },
      false,
    ])
    expect(convert('NullifiedUser')).toEqual([
      {
        $ref: '#/$defs/Nullify_User',
        $defs: {
          Nullify_User: {
            type: 'object',
            properties: {
              id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
            required: ['id', 'name'],
          },
        },
      },
      false,
    ])
    expect(convert('IsString')).toEqual([{ type: 'string', enum: ['no', 'yes'] }, false])
    expect(convert('Conditional')).toEqual([{ type: 'string', const: 'yes' }, false])
    expect(convert('Distributed')).toEqual([
      {
        $ref: '#/$defs/Distributed',
        $defs: { Distributed: { type: 'string', enum: ['no', 'yes'] } },
      },
      false,
    ])
    expect(convert('Indexed')).toEqual([{ type: 'string' }, false])
    expect(convert('KeyOf')).toEqual([{ type: 'string', enum: ['id', 'name'] }, false])
    expect(convert('ValueOf')).toEqual([{ anyOf: [{ type: 'string' }, { type: 'number' }] }, true])
    expect(convert('Awaited1')).toEqual([{ type: 'number' }, false])
    expect(convert('Returned')).toEqual([
      { type: 'object', properties: { ok: { type: 'boolean', const: true } }, required: ['ok'] },
      false,
    ])
    expect(convert('Extracted')).toEqual([
      {
        type: 'object',
        properties: { kind: { type: 'string', const: 'circle' }, radius: { type: 'number' } },
        required: ['kind', 'radius'],
      },
      false,
    ])
    expect(convert('Excluded')).toEqual([
      { $ref: '#/$defs/Excluded', $defs: { Excluded: { type: 'string', enum: ['b', 'c'] } } },
      false,
    ])
    expect(convert('NonNull')).toEqual([{ type: 'string' }, false])
  })

  it('type-fest', () => {
    expect(convert('Simplified')).toEqual([
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
      false,
    ])
    expect(convert('DeepPartial')).toEqual([
      {
        type: 'object',
        properties: { a: { type: 'object', properties: { b: { type: 'string' } } } },
      },
      false,
    ])
    expect(convert('SetOpt')).toEqual([
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a'],
      },
      false,
    ])
    expect(convert('Excepted')).toEqual([
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      false,
    ])
  })

  it('recursive types', () => {
    expect(convert('TreeNode')).toEqual([
      {
        $ref: '#/$defs/TreeNode',
        $defs: {
          TreeNode: {
            type: 'object',
            properties: {
              value: { type: 'number' },
              children: { type: 'array', items: { $ref: '#/$defs/TreeNode' } },
            },
            required: ['value', 'children'],
          },
        },
      },
      false,
    ])
    expect(convert('Json')).toEqual([
      {
        $ref: '#/$defs/Json',
        $defs: {
          Json: {
            anyOf: [
              { type: 'boolean' },
              { type: 'string' },
              { type: 'number' },
              { type: 'array', items: { $ref: '#/$defs/Json' } },
              { type: 'object', additionalProperties: { $ref: '#/$defs/Json' } },
              { type: 'null' },
            ],
          },
        },
      },
      false,
    ])
    expect(convert('LinkedList')).toEqual([
      {
        $ref: '#/$defs/LinkedList_T',
        $defs: {
          LinkedList_T: {
            type: 'object',
            properties: { value: {}, next: { $ref: '#/$defs/LinkedList_T' } },
            required: ['value'],
          },
        },
      },
      false,
    ])
    expect(convert('NumberList')).toEqual([
      {
        $ref: '#/$defs/NumberList',
        $defs: {
          NumberList: {
            type: 'object',
            properties: { value: { type: 'number' }, next: { $ref: '#/$defs/Recursive' } },
            required: ['value'],
          },
          Recursive: { $ref: '#/$defs/LinkedList_number' },
          LinkedList_number: {
            type: 'object',
            properties: { value: { type: 'number' }, next: { $ref: '#/$defs/Recursive' } },
            required: ['value'],
          },
        },
      },
      false,
    ])
    expect(convert('A')).toEqual([
      {
        $ref: '#/$defs/A',
        $defs: {
          A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/$defs/A' } } },
        },
      },
      false,
    ])
    expect(convert('B')).toEqual([
      {
        $ref: '#/$defs/B',
        $defs: {
          B: { type: 'object', properties: { a: { $ref: '#/$defs/A' } } },
          A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } },
        },
      },
      false,
    ])
  })

  it('jsdoc', () => {
    expect(convert('Documented')).toEqual([
      {
        $ref: '#/$defs/Documented',
        $defs: {
          Documented: {
            type: 'object',
            properties: {
              age: {
                type: 'number',
                description: 'The age in years',
                minimum: 0,
                maximum: 150,
                default: 18,
              },
              email: { type: 'string', format: 'email', examples: ['a@b.c'] },
              mail: { type: 'string', deprecated: true },
              count: { type: 'integer' },
              slug: { type: 'string', pattern: '^[a-z]+$' },
              user: { $ref: '#/$defs/User', description: 'Refers a user' },
            },
            required: ['age', 'email', 'count', 'slug', 'user'],
          },
          User: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
            description: 'A registered user',
          },
        },
      },
      false,
    ])
  })

  describe('edge cases', () => {
    let edge: TypeScriptProject

    beforeAll(() => {
      edge = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/edge.ts', import.meta.url),
      })
    })

    afterAll(() => {
      edge.close()
    })

    const create = (options?: ConstructorParameters<typeof TypeToJsonSchemaConverter>[2]) =>
      new TypeToJsonSchemaConverter(edge.checker, edge.program, options)

    it('postfixes conflicting def names', () => {
      expect(create().convert(edge.getExportType('BothUsers').type)).toEqual([
        {
          $ref: '#/$defs/BothUsers',
          $defs: {
            BothUsers: {
              type: 'object',
              properties: { user: { $ref: '#/$defs/User' }, other: { $ref: '#/$defs/User2' } },
              required: ['user', 'other'],
            },
            User: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
              required: ['id', 'name'],
              description: 'A registered user',
            },
            User2: {
              type: 'object',
              properties: { email: { type: 'string' } },
              required: ['email'],
              description: 'Another user, with the same name',
            },
          },
        },
        false,
      ])
    })

    it('throws on unresolved types', () => {
      expect(() => create().convert(edge.getExportType('WithMissing').type)).toThrow(
        TypeScriptTypeResolutionError,
      )
      expect(() => create().convert(edge.getExportType('WithMissing').type)).toThrow(
        'Could not resolve the type "Missing"',
      )
    })

    it('reuses cached defs across conversions with their dependencies', () => {
      const c = create()
      const first = c.convert(edge.getExportType('BothUsers').type)
      const second = c.convert(edge.getExportType('BothUsers').type)
      expect(second).toEqual(first)
    })

    it('defs: recursive only names recursive types', () => {
      expect(create({ defs: 'recursive' }).convert(edge.getExportType('BothUsers').type)).toEqual([
        {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
              required: ['id', 'name'],
            },
            other: {
              type: 'object',
              properties: { email: { type: 'string' } },
              required: ['email'],
            },
          },
          required: ['user', 'other'],
        },
        false,
      ])

      const recursive = new TypeToJsonSchemaConverter(project.checker, project.program, {
        defs: 'recursive',
      })
      expect(recursive.convert(project.getExportType('TreeNode').type)).toEqual([
        {
          $ref: '#/$defs/TreeNode',
          $defs: {
            TreeNode: {
              type: 'object',
              properties: {
                value: { type: 'number' },
                children: { type: 'array', items: { $ref: '#/$defs/TreeNode' } },
              },
              required: ['value', 'children'],
            },
          },
        },
        false,
      ])
    })

    it('getAsyncIteratorTypes', () => {
      const c = create()
      const toString = (name: string) => {
        const types = c.getAsyncIteratorTypes(edge.getExportType(name).type)
        return types && [types.yieldType, types.returnType].map((t) => edge.checker.typeToString(t))
      }

      expect(toString('Gen')).toEqual(['{ n: number; }', '"done"'])
      expect(toString('Iter')).toEqual(['string', 'any'])
      expect(toString('IterObject')).toEqual(['number', 'void'])
      expect(toString('NotIter')).toBeUndefined()
      expect(toString('BothUsers')).toBeUndefined()
    })
  })
})
