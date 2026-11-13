import type { TypeScriptProject } from './project'
import { openTypeScriptProject } from './project'
import { TypeScriptTypeResolutionError, TypeToJsonSchemaConverter } from './type-converter'

const FIXTURE = new URL('../tests/fixtures/types/src/types.ts', import.meta.url)

describe('typeToJsonSchemaConverter', () => {
  let project: TypeScriptProject
  let converter: TypeToJsonSchemaConverter

  const convert = (name: string) => converter.convert(project.getExportType(name).type)
  // the keys a number index checks
  const numberKeys = (schema: object) => ({ '^(?:0|-?[1-9]\\d{0,14})$': schema })

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
    // `object` is also an array, a `Date` (a string), or a function, which is written as nothing
    expect(convert('Obj')).toEqual([{}, true])
    // a symbol (like a function) is written as nothing, like `undefined`
    expect(convert('Sym')).toEqual([{}, true])
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
              // never written
              'alwaysUndefined': { not: {} },
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
    // `{}` also holds a function
    expect(convert('Empty')).toEqual([{}, true])
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
        $defs: {
          // an array or a string has a number index too
          NumDict: {
            anyOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' },
              { type: 'object', patternProperties: numberKeys({ type: 'string' }) },
            ],
          },
        },
      },
      false,
    ])
    expect(convert('PrefixedDict')).toEqual([
      {
        $ref: '#/$defs/PrefixedDict',
        $defs: {
          PrefixedDict: {
            type: 'object',
            patternProperties: { '^x-[\\s\\S]*$': { type: 'string' } },
          },
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
            prefixItems: [{ type: 'string' }, { anyOf: [{ type: 'number' }, { type: 'null' }] }],
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
    const [template] = convert('Template') as [any, boolean]
    const pattern = new RegExp(template.pattern, 'u')

    // the strings TypeScript accepts for `user-${number}`: `+s` is finite
    for (const valid of [
      'user-1',
      'user--1.5e3',
      'user-.5',
      'user-0x1F',
      'user-0b101',
      'user- 1 ',
      // `+' '` is `0`
      'user- ',
      'user-\t',
    ]) {
      expect(pattern.test(valid)).toBe(true)
    }
    for (const invalid of ['user-', 'user-abc', 'user-1_0', 'user--0x1']) {
      expect(pattern.test(invalid)).toBe(false)
    }
    expect(convert('TemplateMulti')).toEqual([
      {
        anyOf: [
          { type: 'string', pattern: '^GET \\/[\\s\\S]*$' },
          { type: 'string', pattern: '^POST \\/[\\s\\S]*$' },
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
              promise: { type: 'object' },
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
    expect(convert('WithAccessors')).toEqual([
      {
        $ref: '#/$defs/WithAccessors',
        $defs: {
          WithAccessors: {
            type: 'object',
            properties: { computed: { type: 'string' }, writable: { type: 'number' } },
            required: ['computed', 'writable'],
          },
        },
      },
      false,
    ])
    expect(convert('LiteralWithGetter')).toEqual([
      { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
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
      {
        $ref: '#/$defs/PartialUser',
        $defs: {
          PartialUser: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
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
      {
        $ref: '#/$defs/RequiredUser',
        $defs: {
          RequiredUser: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        },
      },
      false,
    ])
    expect(convert('ReadonlyUser')).toEqual([
      {
        $ref: '#/$defs/ReadonlyUser',
        $defs: {
          ReadonlyUser: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
      },
      false,
    ])
    expect(convert('Getters')).toEqual([{}, false])
    expect(convert('Nullify')).toEqual([{}, false])
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
        $ref: '#/$defs/Simplified',
        $defs: {
          Simplified: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            required: ['a', 'b'],
          },
        },
      },
      false,
    ])
    expect(convert('DeepPartial')).toEqual([
      {
        $ref: '#/$defs/DeepPartial',
        $defs: {
          DeepPartial: {
            type: 'object',
            properties: { a: { type: 'object', properties: { b: { type: 'string' } } } },
          },
        },
      },
      false,
    ])
    expect(convert('SetOpt')).toEqual([
      {
        $ref: '#/$defs/SetOpt',
        $defs: {
          SetOpt: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            required: ['a'],
          },
        },
      },
      false,
    ])
    expect(convert('Excepted')).toEqual([
      {
        $ref: '#/$defs/Excepted',
        $defs: {
          Excepted: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      },
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
            properties: { value: { type: 'number' }, next: { $ref: '#/$defs/LinkedList_number' } },
            required: ['value'],
          },
          LinkedList_number: {
            type: 'object',
            properties: { value: { type: 'number' }, next: { $ref: '#/$defs/LinkedList_number' } },
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

  describe('complex types', () => {
    let complex: TypeScriptProject
    let c: TypeToJsonSchemaConverter

    beforeAll(() => {
      complex = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/complex.ts', import.meta.url),
      })
      c = new TypeToJsonSchemaConverter(complex.checker, complex.program)
    })

    afterAll(() => {
      complex.close()
    })

    const convertComplex = (name: string) => c.convert(complex.getExportType(name).type)

    const USER = {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      description: 'A registered user',
    }

    it('generic discriminated unions', () => {
      expect(convertComplex('UserResult')).toEqual([
        {
          $ref: '#/$defs/UserResult',
          $defs: {
            UserResult: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', const: true },
                    value: { $ref: '#/$defs/User' },
                  },
                  required: ['ok', 'value'],
                },
                {
                  type: 'object',
                  properties: { ok: { type: 'boolean', const: false }, error: { type: 'string' } },
                  required: ['ok', 'error'],
                },
              ],
            },
            User: USER,
          },
        },
        false,
      ])
    })

    it('generic results nested in arrays, unions of arrays, and intersections with enums', () => {
      const RESULT_ERROR = {
        type: 'object',
        properties: { ok: { type: 'boolean', const: false }, error: { type: 'string' } },
        required: ['ok', 'error'],
      }

      expect(convertComplex('DeepGeneric')).toEqual([
        {
          $ref: '#/$defs/DeepGeneric',
          $defs: {
            'DeepGeneric': {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', const: true },
                    value: { type: 'array', items: { $ref: '#/$defs/Result_with-id_Error' } },
                  },
                  required: ['ok', 'value'],
                },
                RESULT_ERROR,
              ],
            },
            'Result_with-id_Error': {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', const: true },
                    value: {
                      type: 'object',
                      properties: { id: { type: 'number' } },
                      required: ['id'],
                    },
                  },
                  required: ['ok', 'value'],
                },
                // an `Error` instance is written by `JSON.stringify`
                {
                  ...RESULT_ERROR,
                  properties: { ...RESULT_ERROR.properties, error: { type: 'object' } },
                },
              ],
            },
          },
        },
        false,
      ])
      expect(convertComplex('UnionOfArrays')).toEqual([
        {
          $ref: '#/$defs/UnionOfArrays',
          $defs: {
            UnionOfArrays: {
              anyOf: [
                { type: 'array', items: { type: 'string' } },
                { type: 'array', items: { type: 'number' } },
              ],
            },
          },
        },
        false,
      ])
      expect(convertComplex('Combined')).toEqual([
        {
          $ref: '#/$defs/Combined',
          $defs: {
            Combined: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                role: { $ref: '#/$defs/Role' },
              },
              required: ['id', 'name', 'role'],
            },
            Role: { type: 'string', enum: ['admin', 'member'] },
          },
        },
        false,
      ])
    })

    it('records keyed by numbers, and objects requiring one of their keys', () => {
      // a JSON key is a string, so a numeric key is left unconstrained, and an object literal
      // type may hold other keys, which the number index does not check
      expect(convertComplex('NumberKeys')).toEqual([
        {
          $ref: '#/$defs/NumberKeys',
          $defs: {
            NumberKeys: {
              anyOf: [
                { type: 'array', items: { type: 'string' } },
                { type: 'string' },
                { type: 'object', patternProperties: numberKeys({ type: 'string' }) },
              ],
            },
          },
        },
        false,
      ])
      expect(convertComplex('AtLeastOne')).toEqual([
        {
          anyOf: [
            {
              type: 'object',
              properties: { a: { type: 'string' }, b: { type: 'number' } },
              required: ['a'],
            },
            {
              type: 'object',
              properties: { b: { type: 'number' }, a: { type: 'string' } },
              required: ['b'],
            },
          ],
        },
        false,
      ])
    })

    it('records keyed by enums', () => {
      expect(convertComplex('RoleRecord')).toEqual([
        {
          $ref: '#/$defs/RoleRecord',
          $defs: {
            RoleRecord: {
              type: 'object',
              properties: { admin: { type: 'boolean' }, member: { type: 'boolean' } },
              required: ['admin', 'member'],
            },
          },
        },
        false,
      ])
      expect(convertComplex('PartialRoleRecord')).toEqual([
        {
          $ref: '#/$defs/PartialRoleRecord',
          $defs: {
            PartialRoleRecord: {
              type: 'object',
              properties: { admin: { type: 'number' }, member: { type: 'number' } },
            },
          },
        },
        false,
      ])
      expect(convertComplex('Keys')).toEqual([
        { type: 'string', enum: ['admin-key', 'member-key'] },
        false,
      ])
    })

    it('type-fest deep utilities', () => {
      expect(convertComplex('Camel')).toEqual([
        {
          $ref: '#/$defs/Camel',
          $defs: {
            Camel: {
              type: 'object',
              properties: {
                nestedObj: {
                  type: 'object',
                  properties: { firstValue: { type: 'number' } },
                  required: ['firstValue'],
                },
                userName: { type: 'string' },
              },
              required: ['nestedObj', 'userName'],
            },
          },
        },
        false,
      ])
      expect(convertComplex('Jsonified')).toEqual([
        {
          $ref: '#/$defs/Jsonified',
          $defs: {
            Jsonified: {
              type: 'object',
              properties: { date: { type: 'string' }, n: { type: 'number' } },
              required: ['date', 'n'],
            },
          },
        },
        false,
      ])
      expect(convertComplex('DeepRO')).toEqual([
        {
          $ref: '#/$defs/DeepRO',
          $defs: {
            DeepRO: {
              type: 'object',
              properties: {
                a: {
                  type: 'object',
                  properties: { b: { type: 'array', items: { type: 'string' } } },
                  required: ['b'],
                },
              },
              required: ['a'],
            },
          },
        },
        false,
      ])
      // the keys of the other members are never written
      expect(convertComplex('ExactlyOne')).toEqual([
        {
          anyOf: [
            {
              type: 'object',
              properties: { a: { type: 'string' }, b: { not: {} } },
              required: ['a'],
            },
            {
              type: 'object',
              properties: { a: { not: {} }, b: { type: 'number' } },
              required: ['b'],
            },
          ],
        },
        false,
      ])
      expect(convertComplex('Writ')).toEqual([
        {
          $ref: '#/$defs/Writ',
          $defs: {
            Writ: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          },
        },
        false,
      ])
    })

    it('callable types', () => {
      // written as nothing, like `undefined`
      expect(convertComplex('Overloaded')).toEqual([{}, true])
      expect(convertComplex('WithOverload')).toEqual([
        {
          $ref: '#/$defs/WithOverload',
          $defs: {
            WithOverload: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
        false,
      ])
    })

    it('nullable and mixed unions', () => {
      expect(convertComplex('NestedNull')).toEqual([
        {
          $ref: '#/$defs/NestedNull',
          $defs: {
            NestedNull: {
              type: 'object',
              properties: {
                a: {
                  anyOf: [
                    {
                      type: 'object',
                      properties: { b: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
                      required: ['b'],
                    },
                    { type: 'null' },
                  ],
                },
              },
              required: ['a'],
            },
          },
        },
        false,
      ])
      expect(convertComplex('InterfaceInUnion')).toEqual([
        {
          $ref: '#/$defs/InterfaceInUnion',
          $defs: {
            InterfaceInUnion: {
              anyOf: [
                { type: 'string', const: 'anonymous' },
                { $ref: '#/$defs/User' },
                { type: 'null' },
              ],
            },
            User: USER,
          },
        },
        false,
      ])
      expect(convertComplex('OptionalTuple')).toEqual([
        {
          $ref: '#/$defs/OptionalTuple',
          $defs: {
            OptionalTuple: {
              type: 'array',
              prefixItems: [
                { anyOf: [{ type: 'string' }, { type: 'null' }] },
                { anyOf: [{ type: 'number' }, { type: 'null' }] },
              ],
              maxItems: 2,
            },
          },
        },
        false,
      ])
    })
  })

  describe('augmented globals and library classes', () => {
    it('keeps recognizing Error subclasses when a package augments the global Error', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/augmented/src/index.ts', import.meta.url),
      })

      try {
        const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
          project.getExportType('Errors').type,
        ) as [any, boolean]

        expect(schema.$defs.AppError).toEqual({
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code'],
        })
        // the fixture augments `TypeError` with `code`
        expect(schema.$defs.Errors.properties.type).toEqual({
          type: 'object',
          properties: { code: { type: 'string' } },
        })
        expect(schema.$defs.Errors.properties.plain).toEqual({ type: 'object' })
      } finally {
        project.close()
      }
    })

    it('leaves members a package adds to Error out of required through a view of Error', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/augmented/src/index.ts', import.meta.url),
      })

      try {
        for (const direction of ['output', 'input'] as const) {
          const converter = new TypeToJsonSchemaConverter(project.checker, project.program, {
            direction,
          })
          const [schema] = converter.convert(project.getExportType('ErrorViews').type) as [
            any,
            boolean,
          ]

          // an instance does not write `~augments/reported`, as for `interface AppError extends Error`
          for (const name of ['ReadonlyAppError', 'OmittedAppError']) {
            expect(schema.$defs[name].properties).toHaveProperty(['~augments/reported'])
            expect(schema.$defs[name].required).toEqual(['code'])
          }
        }
      } finally {
        project.close()
      }
    })

    it('treats interfaces as classes only when a library constructor creates them', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/augmented/src/index.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        const [constructed] = converter.convert(project.getExportType('Constructed').type) as [
          any,
          boolean,
        ]
        const set = expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' })

        // package types are inlined
        const { opaque, session } = constructed.$defs.Constructed.properties

        expect(opaque.properties.tags).toEqual(set)
        expect(constructed.$defs.User.properties.roles).toEqual(set)
        // a library class is written by `JSON.stringify`, which writes a `Set` as `{}`
        expect(session.properties.tags).toEqual({ type: 'object' })

        const [polyfills] = converter.convert(project.getExportType('WithPolyfills').type) as [
          any,
          boolean,
        ]
        expect(polyfills.$defs.WithPolyfills.properties).toEqual({
          big: { type: 'string' },
          counts: { type: 'array', items: expect.objectContaining({ type: 'array' }) },
        })
      } finally {
        project.close()
      }
    })

    it('recognizes library classes augmented by the project or created through other types', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/augmented/src/index.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        const [classes] = converter.convert(project.getExportType('LibraryClasses').type) as [
          any,
          boolean,
        ]
        const { typeError, ...created } = classes.$defs.LibraryClasses.properties

        // `name` and `message` are not own enumerable data, `code` is the project's
        expect(typeError).toEqual({ type: 'object', properties: { code: { type: 'string' } } })
        for (const value of Object.values(created)) {
          expect((value as any).properties.tags).toEqual({ type: 'object' })
        }

        const [cases] = converter.convert(project.getExportType('ToJSONCases').type) as [
          any,
          boolean,
        ]
        expect(cases.$defs.MaybeJSON).toEqual({
          anyOf: [
            { type: 'string' },
            { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
          ],
        })
        expect(cases.$defs.Account).toEqual({
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        })
      } finally {
        project.close()
      }
    })

    it('treats workspace packages linked into node_modules as project code', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/workspace/api/src/index.ts', import.meta.url),
      })

      try {
        const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
          project.getExportType('Planets').type,
        ) as [any, boolean]

        expect(schema.$defs.Planet).toEqual({
          type: 'object',
          properties: { id: { type: 'string', description: 'The id' }, name: { type: 'string' } },
          required: ['id', 'name'],
          description: 'A stored planet',
        })
      } finally {
        project.close()
      }
    })

    it('describes web classes of the Node typings as class instances', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/node-only/src/upload.ts', import.meta.url),
      })

      try {
        const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
          project.getExportType('WebClasses').type,
        ) as [any, boolean]

        expect(schema.$defs.WebClasses.properties).toEqual({
          response: { type: 'object' },
          request: { type: 'object' },
        })

        // a `Buffer` writes `toJSON`, a plain partial value its index keys
        const [partial] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
          project.getExportType('PartialBuffer').type,
        ) as [any, boolean]
        expect(partial.$defs.PartialBuffer.properties.v.anyOf).toEqual([
          expect.objectContaining({ required: ['type', 'data'] }),
          { type: 'object', additionalProperties: { type: 'number' } },
        ])
      } finally {
        project.close()
      }
    })
  })

  describe('type requests', () => {
    it('asks for the signatures of each type once', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/type-requests.ts', import.meta.url),
      })

      try {
        const spy = vi.spyOn(project.checker, 'getSignaturesOfType')
        const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
          project.getExportType('Wide').type,
        ) as [any, boolean]

        expect(Object.keys(schema.$defs)).toHaveLength(41)
        // 40 members of `Wide | undefined`, asked by each of the 40 `next` properties before
        expect(spy.mock.calls.length).toBeLessThan(200)
      } finally {
        project.close()
      }
    })
  })

  describe('default exports', () => {
    it('names default exports after their declaration', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/default-exports.ts', import.meta.url),
      })

      try {
        const [schema] = new TypeToJsonSchemaConverter(project.checker, project.program).convert(
          project.getExportType('DefaultExports').type,
        ) as [any, boolean]

        expect(Object.keys(schema.$defs).toSorted()).toEqual([
          'Account',
          'DefaultExports',
          'Profile',
        ])
        expect(schema.$defs.Profile.description).toBe('A profile')
      } finally {
        project.close()
      }
    })
  })

  describe('JSDoc keywords, template literal keys and mapped built-ins', () => {
    let r6: TypeScriptProject

    beforeAll(() => {
      r6 = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/mapped-builtins.ts', import.meta.url),
      })
    })

    afterAll(() => {
      r6.close()
    })

    const convertR6 = (name: string) =>
      new TypeToJsonSchemaConverter(r6.checker, r6.program).convert(r6.getExportType(name).type)

    it('fixture has no type errors', () => {
      expect(r6.program.getSemanticDiagnostics(r6.sourceFile.fileName)).toEqual([])
    })

    it('only sets JSDoc keywords to values of their type', () => {
      expect(convertR6('KeywordTypes')).toEqual([
        {
          $ref: '#/$defs/KeywordTypes',
          $defs: {
            KeywordTypes: {
              type: 'object',
              properties: {
                b: { type: 'string', pattern: '[123]' },
                digits: { type: 'string', pattern: '123' },
                year: { type: 'string', title: '2024' },
                a: { type: 'string' },
                inf: { type: 'number' },
                min: { type: 'number', minimum: 1 },
                ro: { type: 'string', readOnly: true },
                list: { type: 'array', items: { type: 'string' } },
                // `object` is also an array
                config: { default: { x: 1 } },
              },
              required: ['b', 'a', 'min', 'ro', 'list'],
            },
          },
        },
        false,
      ])
    })

    // a template literal index checks only the keys it matches, an object literal type may hold others
    it('template literal keys constrain only the keys they match', () => {
      expect(convertR6('TemplateKeys')).toEqual([
        {
          $ref: '#/$defs/TemplateKeys',
          $defs: {
            TemplateKeys: {
              type: 'object',
              properties: {
                headers: {
                  type: 'object',
                  patternProperties: { '^x-[\\s\\S]*$': { type: 'string' } },
                },
                big: { type: 'object', additionalProperties: { type: 'number' } },
                mixed: {
                  type: 'object',
                  properties: { known: { type: 'string' } },
                  required: ['known'],
                  patternProperties: { '^x-[\\s\\S]*$': { type: 'string' } },
                },
              },
              required: ['headers', 'big', 'mixed'],
            },
          },
        },
        false,
      ])
    })

    it('mapped types are built-ins only when mapping over one', () => {
      expect(convertR6('NotBuiltins')).toEqual([
        {
          $ref: '#/$defs/NotBuiltins',
          $defs: {
            NotBuiltins: {
              type: 'object',
              properties: {
                times: { $ref: '#/$defs/Timestamps' },
                at: { $ref: '#/$defs/Versioned_Date' },
                pair: { $ref: '#/$defs/Pair_Set_string_number' },
              },
              required: ['times', 'at', 'pair'],
            },
            Pair_Set_string_number: {
              type: 'object',
              properties: {
                left: {
                  'type': 'array',
                  'uniqueItems': true,
                  'items': { type: 'string' },
                  'x-native-type': 'set',
                },
                right: { type: 'number' },
              },
              required: ['left', 'right'],
            },
            Versioned_Date: {
              type: 'object',
              properties: {
                current: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
                previous: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
              },
              required: ['current', 'previous'],
            },
            Timestamps: {
              type: 'object',
              properties: {
                createdAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
                updatedAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
              },
              required: ['createdAt', 'updatedAt'],
            },
          },
        },
        false,
      ])
      expect(convertR6('PartialLookAlikes')).toEqual([
        {
          $ref: '#/$defs/PartialLookAlikes',
          $defs: {
            PartialLookAlikes: {
              type: 'object',
              properties: {
                params: {
                  type: 'object',
                  properties: {
                    size: {
                      type: 'number',
                      description:
                        'The **`size`** read-only property of the URLSearchParams interface indicates the total number of search parameter entries.\n\n[MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/size)',
                    },
                  },
                },
                account: { type: 'object', properties: { id: { type: 'string' } } },
                // a view of the interface, whose optional members may hold a plain object
                map: {
                  anyOf: [
                    {
                      'type': 'array',
                      'items': { type: 'array', prefixItems: [{}, {}], maxItems: 2, minItems: 2 },
                      'x-native-type': 'map',
                    },
                    // a `Set` has a `size` too
                    { 'type': 'array', 'items': {}, 'x-native-type': 'set' },
                    { type: 'object', properties: { size: { type: 'number' } } },
                  ],
                },
              },
            },
          },
        },
        false,
      ])
    })

    it('mapped types changing the values of a built-in are plain objects', () => {
      expect(convertR6('ValueMappedBuiltins')).toEqual([
        {
          $ref: '#/$defs/ValueMappedBuiltins',
          $defs: {
            ValueMappedBuiltins: {
              type: 'object',
              properties: {
                set: { $ref: '#/$defs/Stringified_Set_number' },
                map: { type: 'object', properties: { size: { type: 'number' } } },
              },
              required: ['set', 'map'],
              description:
                "Mapped types changing the values of a built-in's members, whose values are plain objects",
            },
            Stringified_Set_number: {
              type: 'object',
              properties: { size: { type: 'string' } },
              required: ['size'],
            },
          },
        },
        false,
      ])
    })

    it('names numeric literal arguments without collisions', () => {
      expect(convertR6('NumericPages')).toEqual([
        {
          $ref: '#/$defs/NumericPages',
          $defs: {
            NumericPages: {
              type: 'object',
              properties: {
                a: { $ref: '#/$defs/Page_neg1' },
                b: { $ref: '#/$defs/Page_1' },
                c: { $ref: '#/$defs/Page_12' },
              },
              required: ['a', 'b', 'c'],
            },
            Page_12: {
              type: 'object',
              properties: { item: { type: 'number', const: 12 } },
              required: ['item'],
            },
            Page_1: {
              type: 'object',
              properties: { item: { type: 'number', const: 1 } },
              required: ['item'],
            },
            Page_neg1: {
              type: 'object',
              properties: { item: { type: 'number', const: -1 } },
              required: ['item'],
            },
          },
        },
        false,
      ])
    })
  })

  describe('nullable aliases, repeated siblings and wide models', () => {
    let r5: TypeScriptProject

    beforeAll(() => {
      r5 = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/nullable-aliases.ts', import.meta.url),
      })
    })

    afterAll(() => {
      r5.close()
    })

    const converter = () => new TypeToJsonSchemaConverter(r5.checker, r5.program)
    const convertR5 = (name: string, c = converter()) => c.convert(r5.getExportType(name).type)

    it('fixture has no type errors', () => {
      expect(r5.program.getSemanticDiagnostics(r5.sourceFile.fileName)).toEqual([])
    })

    it('uses an annotated nullable alias only when it is the whole property type', () => {
      expect(convertR5('Extended')).toEqual([
        {
          $ref: '#/$defs/Extended',
          $defs: {
            Extended: {
              type: 'object',
              properties: {
                status: {
                  anyOf: [
                    { type: 'string', enum: ['archived', 'closed', 'open'] },
                    { type: 'null' },
                  ],
                },
                count: {
                  anyOf: [
                    { type: 'string', enum: ['closed', 'open'] },
                    { type: 'number' },
                    { type: 'null' },
                  ],
                },
                plain: { $ref: '#/$defs/Status' },
              },
            },
            Status: {
              anyOf: [{ type: 'string', enum: ['closed', 'open'] }, { type: 'null' }],
              description: 'status doc',
            },
          },
        },
        false,
      ])
      expect(convertR5('WithMaybe')).toEqual([
        {
          $ref: '#/$defs/WithMaybe',
          $defs: {
            WithMaybe: {
              type: 'object',
              properties: {
                name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                count: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              },
            },
          },
        },
        false,
      ])
      expect(convertR5('GenericUser')).toEqual([
        {
          $ref: '#/$defs/GenericUser',
          $defs: {
            GenericUser: {
              type: 'object',
              properties: {
                item: {
                  anyOf: [
                    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        },
        false,
      ])
      expect(convertR5('SourceFlags')).toEqual([
        {
          $ref: '#/$defs/Flags_FlagSource',
          $defs: {
            Flags_FlagSource: {
              type: 'object',
              properties: {
                status: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
                title: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
              },
            },
          },
        },
        false,
      ])
    })

    it('does not send unrelated nullable unions to a named one', () => {
      const c = converter()
      expect(convertR5('UsesFlag', c)).toEqual([
        {
          $ref: '#/$defs/UsesFlag',
          $defs: {
            UsesFlag: {
              type: 'object',
              properties: { f: { $ref: '#/$defs/Flag' } },
              required: ['f'],
            },
            Flag: {
              anyOf: [{ type: 'boolean' }, { type: 'null' }],
              description: 'A nullable flag',
            },
          },
        },
        false,
      ])
      expect(convertR5('Unrelated', c)).toEqual([
        {
          $ref: '#/$defs/Unrelated',
          $defs: {
            Unrelated: {
              type: 'object',
              properties: {
                enabled: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
                other: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
              },
              required: ['enabled'],
            },
          },
        },
        false,
      ])
    })

    it('converts types repeated as siblings once', () => {
      const start = performance.now()
      convertR5('Counted')
      expect(performance.now() - start).toBeLessThan(2000)
    })

    it('never cuts wide models under a recursive mapped type', () => {
      const [schema] = convertR5('WidePartial') as [any, boolean]
      expect(Object.keys(schema.$defs)).toHaveLength(71)
      expect(JSON.stringify(schema)).not.toContain(':{}')
    })

    it('deep mapped types over built-ins keep the built-in form', () => {
      expect(convertR5('ReadonlyPost')).toEqual([
        {
          $ref: '#/$defs/DeepReadonly_Post',
          $defs: {
            DeepReadonly_Post: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                createdAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
                tags: { $ref: '#/$defs/DeepReadonly_Set_string' },
                link: { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' },
                counts: { $ref: '#/$defs/DeepReadonly_Map_string_number' },
              },
              required: ['id', 'createdAt', 'tags', 'link', 'counts'],
            },
            DeepReadonly_Map_string_number: {
              'type': 'array',
              'items': {
                type: 'array',
                prefixItems: [{ type: 'string' }, { type: 'number' }],
                maxItems: 2,
                minItems: 2,
              },
              'x-native-type': 'map',
            },
            DeepReadonly_Set_string: {
              'type': 'array',
              'uniqueItems': true,
              'items': { type: 'string' },
              'x-native-type': 'set',
            },
          },
        },
        false,
      ])
      // a conditional deep partial is a view of the interface, like `DeepPartial<Post>`: its
      // values are the built-ins or, all members being optional, plain objects
      const [partial] = convertR5('PartialPost') as [any, boolean]
      const plainObject = expect.objectContaining({ type: 'object' })
      // a def named after the alias, which the type lost
      expect(partial).toEqual({
        $ref: '#/$defs/PartialPost',
        $defs: {
          PartialPost: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              createdAt: {
                anyOf: [
                  { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
                  plainObject,
                ],
              },
              // or a `Map` having the `size` of a `Set`, and the other way around
              tags: {
                anyOf: [
                  { 'type': 'array', 'items': {}, 'x-native-type': 'set' },
                  expect.objectContaining({ 'type': 'array', 'x-native-type': 'map' }),
                  plainObject,
                ],
              },
              link: {
                anyOf: [{ 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }, plainObject],
              },
              counts: {
                anyOf: [
                  expect.objectContaining({ 'type': 'array', 'x-native-type': 'map' }),
                  { 'type': 'array', 'items': {}, 'x-native-type': 'set' },
                  plainObject,
                ],
              },
            },
          },
        },
      })
    })

    it('names generics with literal arguments', () => {
      expect(convertR5('AnyChatEvent')).toEqual([
        {
          $ref: '#/$defs/AnyChatEvent',
          $defs: {
            AnyChatEvent: {
              oneOf: [
                { $ref: '#/$defs/ChatEvent_message_Message' },
                { $ref: '#/$defs/ChatEvent_ping_null' },
              ],
              discriminator: {
                propertyName: 'type',
                mapping: {
                  message: '#/$defs/ChatEvent_message_Message',
                  ping: '#/$defs/ChatEvent_ping_null',
                },
              },
            },
            ChatEvent_ping_null: {
              type: 'object',
              properties: { type: { type: 'string', const: 'ping' }, data: { type: 'null' } },
              required: ['type', 'data'],
            },
            ChatEvent_message_Message: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'message' },
                data: { $ref: '#/$defs/Message' },
              },
              required: ['type', 'data'],
            },
            Message: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        },
        false,
      ])
    })

    it('Blob, File, and URL from the runtime typings without the DOM library', () => {
      const node = openTypeScriptProject({
        file: new URL('../tests/fixtures/node-only/src/upload.ts', import.meta.url),
      })

      try {
        expect(node.program.getSemanticDiagnostics(node.sourceFile.fileName)).toEqual([])
        expect(
          new TypeToJsonSchemaConverter(node.checker, node.program).convert(
            node.getExportType('Upload').type,
          ),
        ).toEqual([
          {
            $ref: '#/$defs/Upload',
            $defs: {
              Upload: {
                type: 'object',
                properties: {
                  file: { type: 'string', contentMediaType: '*/*' },
                  blob: { type: 'string', contentMediaType: '*/*' },
                  url: { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' },
                },
                required: ['file', 'blob', 'url'],
              },
            },
          },
          false,
        ])
      } finally {
        node.close()
      }
    })
  })

  describe('expansion cuts and class expressions', () => {
    let r4: TypeScriptProject

    beforeAll(() => {
      r4 = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/expansion-cuts.ts', import.meta.url),
      })
    })

    afterAll(() => {
      r4.close()
    })

    const convertR4 = (
      name: string,
      options?: ConstructorParameters<typeof TypeToJsonSchemaConverter>[2],
    ) =>
      new TypeToJsonSchemaConverter(r4.checker, r4.program, options).convert(
        r4.getExportType(name).type,
      )

    const countEmpty = (value: unknown): number =>
      (JSON.stringify(value).match(/:\{\}/gu) ?? []).length

    it('fixture has no type errors', () => {
      expect(r4.program.getSemanticDiagnostics(r4.sourceFile.fileName)).toEqual([])
    })

    it('never cuts sibling instantiations', () => {
      expect(countEmpty(convertR4('ManyArrays'))).toBe(0)
      const [boxes] = convertR4('ManyBoxes') as [any, boolean]
      expect(Object.keys(boxes.$defs)).toHaveLength(71)
      expect(countEmpty(boxes)).toBe(0)
    })

    it('never cuts a type revisited through named defs', () => {
      const [hub] = convertR4('HubRoot') as [any, boolean]
      expect(Object.keys(hub.$defs)).toHaveLength(21)
      expect(countEmpty(hub)).toBe(0)
    })

    it('names class expressions after their variable', () => {
      expect(convertR4('ExprInstance')).toEqual([
        {
          $ref: '#/$defs/Expr',
          $defs: {
            Expr: { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
          },
        },
        false,
      ])
    })

    it('detects growth through object literal arguments', () => {
      expect(convertR4('StringThread')).toEqual([
        {
          $ref: '#/$defs/StringThread',
          $defs: {
            'StringThread': {
              type: 'object',
              properties: {
                item: { type: 'string' },
                replies: { type: 'array', items: { $ref: '#/$defs/Thread_with-parent' } },
              },
              required: ['item', 'replies'],
            },
            'Thread_with-parent': {
              type: 'object',
              properties: {
                item: {
                  type: 'object',
                  properties: { parent: { type: 'string' } },
                  required: ['parent'],
                },
                replies: { type: 'array', items: { $ref: '#/$defs/Thread_with-parent2' } },
              },
              required: ['item', 'replies'],
            },
            'Thread_with-parent2': {
              type: 'object',
              properties: {
                item: {
                  type: 'object',
                  properties: {
                    parent: {
                      type: 'object',
                      properties: { parent: { type: 'string' } },
                      required: ['parent'],
                    },
                  },
                  required: ['parent'],
                },
                replies: { type: 'array', items: { $ref: '#/$defs/Thread_with-parent3' } },
              },
              required: ['item', 'replies'],
            },
            'Thread_with-parent3': {
              type: 'object',
              properties: {
                item: {
                  type: 'object',
                  properties: {
                    parent: {
                      type: 'object',
                      properties: {
                        parent: {
                          type: 'object',
                          properties: { parent: { type: 'string' } },
                          required: ['parent'],
                        },
                      },
                      required: ['parent'],
                    },
                  },
                  required: ['parent'],
                },
                replies: { type: 'array', items: {} },
              },
              required: ['item', 'replies'],
            },
          },
        },
        false,
      ])
    })

    it('keeps named nullable unions behind optional properties', () => {
      expect(convertR4('Doc')).toEqual([
        {
          $ref: '#/$defs/Doc',
          $defs: {
            Doc: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                body: { $ref: '#/$defs/Json' },
                status: { $ref: '#/$defs/Status' },
                optionalJson: { $ref: '#/$defs/OptionalJson' },
              },
              required: ['id', 'optionalJson'],
            },
            OptionalJson: {
              anyOf: [
                { type: 'boolean' },
                { type: 'string' },
                { type: 'number' },
                { type: 'array', items: { $ref: '#/$defs/OptionalJson' } },
                { type: 'object', additionalProperties: { $ref: '#/$defs/OptionalJson' } },
                { type: 'null' },
              ],
            },
            Status: {
              anyOf: [{ type: 'string', enum: ['closed', 'open'] }, { type: 'null' }],
              description: 'Nullable status',
            },
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
    })

    it('ignores toJSON of plain object literals', () => {
      expect(convertR4('PlainWithToJSON')).toEqual([
        { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
        false,
      ])
    })

    it('makes the def at the named type of a cycle, not at its wrapper', () => {
      expect(convertR4('WrappersFirst', { defs: 'recursive' })).toEqual([
        {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/$defs/TreeItem' } },
            dicts: { type: 'object', additionalProperties: { $ref: '#/$defs/Dict' } },
          },
          required: ['items', 'dicts'],
          $defs: {
            Dict: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                entries: { type: 'object', additionalProperties: { $ref: '#/$defs/Dict' } },
              },
              required: ['name', 'entries'],
            },
            TreeItem: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                children: { type: 'array', items: { $ref: '#/$defs/TreeItem' } },
              },
              required: ['id', 'children'],
            },
          },
        },
        false,
      ])
    })

    it('skips members inherited from runtime classes and package errors', () => {
      expect(convertR4('MyStream')).toEqual([
        {
          $ref: '#/$defs/MyStream',
          $defs: {
            MyStream: {
              type: 'object',
              properties: { tag: { type: 'string' } },
              required: ['tag'],
            },
          },
        },
        false,
      ])
      expect(convertR4('MyZodError')).toEqual([
        {
          $ref: '#/$defs/MyZodError',
          $defs: {
            MyZodError: {
              type: 'object',
              properties: { extra: { type: 'number' } },
              required: ['extra'],
            },
          },
        },
        false,
      ])
    })
  })

  describe('growth detection and alias JSDoc', () => {
    let r3: TypeScriptProject

    beforeAll(() => {
      r3 = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/growth.ts', import.meta.url),
      })
    })

    afterAll(() => {
      r3.close()
    })

    const convertR3 = (
      name: string,
      c = new TypeToJsonSchemaConverter(r3.checker, r3.program),
      options?: Parameters<TypeToJsonSchemaConverter['convert']>[1],
    ) => c.convert(r3.getExportType(name).type, options)

    it('fixture has no type errors', () => {
      expect(r3.program.getSemanticDiagnostics(r3.sourceFile.fileName)).toEqual([])
    })

    it('does not mistake similar names or finite re-instantiations for growth', () => {
      expect(convertR3('HolderTag')).toEqual([
        {
          $ref: '#/$defs/HolderTag',
          $defs: {
            HolderTag: {
              type: 'object',
              properties: { t: { $ref: '#/$defs/Tag_User' } },
              required: ['t'],
            },
            Tag_User: {
              type: 'object',
              properties: {
                owner: { $ref: '#/$defs/User' },
                sub: { $ref: '#/$defs/Tag_UserProfile' },
              },
              required: ['owner'],
            },
            Tag_UserProfile: {
              type: 'object',
              properties: {
                owner: { $ref: '#/$defs/UserProfile' },
                sub: { $ref: '#/$defs/Tag_UserProfile' },
              },
              required: ['owner'],
            },
            UserProfile: {
              type: 'object',
              properties: { bio: { type: 'string' } },
              required: ['bio'],
            },
            User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          },
        },
        false,
      ])
      expect(convertR3('GQuery')).toEqual([
        {
          $ref: '#/$defs/GQuery',
          $defs: {
            GQuery: {
              type: 'object',
              properties: { me: { $ref: '#/$defs/Maybe_GUser' } },
              required: ['me'],
            },
            Maybe_GUser: { anyOf: [{ $ref: '#/$defs/GUser' }, { type: 'null' }] },
            GUser: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                friends: { $ref: '#/$defs/Maybe_GUserArray' },
                best: { $ref: '#/$defs/Maybe_GUser' },
              },
              required: ['id', 'friends', 'best'],
            },
            Maybe_GUserArray: {
              anyOf: [{ type: 'array', items: { $ref: '#/$defs/GUser' } }, { type: 'null' }],
            },
          },
        },
        false,
      ])
      expect(convertR3('HolderWiden')).toEqual([
        {
          $ref: '#/$defs/HolderWiden',
          $defs: {
            HolderWiden: {
              type: 'object',
              properties: { w: { $ref: '#/$defs/Widen_string' } },
              required: ['w'],
            },
            Widen_string: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                next: { anyOf: [{ $ref: '#/$defs/Widen' }, { type: 'null' }] },
              },
              required: ['value', 'next'],
            },
            Widen: {
              type: 'object',
              properties: {
                value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                next: { anyOf: [{ $ref: '#/$defs/Widen' }, { type: 'null' }] },
              },
              required: ['value', 'next'],
            },
          },
        },
        false,
      ])
    })

    it('stops branching expansions quickly', () => {
      const start = performance.now()
      const [schema] = convertR3('HolderGrow') as [any, boolean]
      expect(performance.now() - start).toBeLessThan(5000)
      expect(Object.keys(schema.$defs).length).toBeLessThan(300)
    })

    it('applies alias JSDoc once, also to literal aliases', () => {
      expect(convertR3('AliasDocs')).toEqual([
        {
          $ref: '#/$defs/AliasDocs',
          $defs: {
            AliasDocs: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'A name', examples: ['bob'] },
                answer: { type: 'number', const: 42, description: 'Always 42' },
                legacy: {
                  type: 'string',
                  const: 'old',
                  description: 'A legacy status',
                  deprecated: true,
                },
              },
              required: ['name', 'answer', 'legacy'],
            },
          },
        },
        false,
      ])
    })

    it('does not create defs for wrappers of recursive named types', () => {
      expect(convertR3('Person')).toEqual([
        {
          $ref: '#/$defs/Person',
          $defs: {
            Person: {
              type: 'object',
              properties: { name: { type: 'string' }, team: { $ref: '#/$defs/Team' } },
              required: ['name'],
            },
            Team: {
              type: 'object',
              properties: { lead: { $ref: '#/$defs/Person' }, parent: { $ref: '#/$defs/Team' } },
            },
          },
        },
        false,
      ])

      const c = new TypeToJsonSchemaConverter(r3.checker, r3.program)
      expect(convertR3('Forest', c)).toEqual([
        {
          $ref: '#/$defs/Forest',
          $defs: {
            Forest: {
              type: 'object',
              properties: { trees: { type: 'array', items: { $ref: '#/$defs/Tree' } } },
              required: ['trees'],
            },
            Tree: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                children: { type: 'array', items: { $ref: '#/$defs/Tree' } },
              },
              required: ['id', 'children'],
            },
          },
        },
        false,
      ])
      expect(convertR3('Tree', c)).toEqual([
        {
          $ref: '#/$defs/Tree',
          $defs: {
            Tree: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                children: { type: 'array', items: { $ref: '#/$defs/Tree' } },
              },
              required: ['id', 'children'],
            },
          },
        },
        false,
      ])
    })

    it('subclasses of Date and URL', () => {
      expect(convertR3('Subclasses')).toEqual([
        {
          $ref: '#/$defs/Subclasses',
          $defs: {
            Subclasses: {
              type: 'object',
              properties: {
                date: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
                url: { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' },
              },
              required: ['date', 'url'],
            },
          },
        },
        false,
      ])
    })

    it('inlineRoot inlines the members of a named root union', () => {
      expect(convertR3('QU', undefined, { inlineRoot: true })).toEqual([
        {
          anyOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'a' }, a: { type: 'string' } },
              required: ['kind', 'a'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'b' }, b: { type: 'string' } },
              required: ['kind', 'b'],
            },
          ],
        },
        false,
      ])
    })
  })

  describe('generic instantiations, built-in subclasses and literals', () => {
    let r2: TypeScriptProject

    beforeAll(() => {
      r2 = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/generic-instantiations.ts', import.meta.url),
      })
    })

    afterAll(() => {
      r2.close()
    })

    const convertR2 = (name: string, c = new TypeToJsonSchemaConverter(r2.checker, r2.program)) =>
      c.convert(r2.getExportType(name).type)

    it('fixture has no type errors', () => {
      expect(r2.program.getSemanticDiagnostics(r2.sourceFile.fileName)).toEqual([])
    })

    it('distinct generic instantiations convert fully, in any order', () => {
      const c = new TypeToJsonSchemaConverter(r2.checker, r2.program)
      expect(convertR2('L1', c)).toEqual([
        {
          $ref: '#/$defs/L1',
          $defs: {
            L1: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L2' } },
              required: ['id', 'next'],
            },
            Maybe_L2: { anyOf: [{ $ref: '#/$defs/L2' }, { type: 'null' }] },
            L2: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L3' } },
              required: ['id', 'next'],
            },
            Maybe_L3: { anyOf: [{ $ref: '#/$defs/L3' }, { type: 'null' }] },
            L3: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L4' } },
              required: ['id', 'next'],
            },
            Maybe_L4: { anyOf: [{ $ref: '#/$defs/L4' }, { type: 'null' }] },
            L4: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L5' } },
              required: ['id', 'next'],
            },
            Maybe_L5: { anyOf: [{ $ref: '#/$defs/L5' }, { type: 'null' }] },
            L5: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L6' } },
              required: ['id', 'next'],
            },
            Maybe_L6: { anyOf: [{ $ref: '#/$defs/L6' }, { type: 'null' }] },
            L6: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L7' } },
              required: ['id', 'next'],
            },
            Maybe_L7: { anyOf: [{ $ref: '#/$defs/L7' }, { type: 'null' }] },
            L7: {
              type: 'object',
              properties: { id: { type: 'string' }, leaf: { type: 'number' } },
              required: ['id', 'leaf'],
            },
          },
        },
        false,
      ])
      expect(convertR2('L6', c)).toEqual([
        {
          $ref: '#/$defs/L6',
          $defs: {
            L6: {
              type: 'object',
              properties: { id: { type: 'string' }, next: { $ref: '#/$defs/Maybe_L7' } },
              required: ['id', 'next'],
            },
            Maybe_L7: { anyOf: [{ $ref: '#/$defs/L7' }, { type: 'null' }] },
            L7: {
              type: 'object',
              properties: { id: { type: 'string' }, leaf: { type: 'number' } },
              required: ['id', 'leaf'],
            },
          },
        },
        false,
      ])
      expect(convertR2('PartialConfig')).toEqual([
        {
          $ref: '#/$defs/DeepPartial_with-a',
          $defs: {
            'DeepPartial_with-a': {
              type: 'object',
              properties: { a: { $ref: '#/$defs/DeepPartial_with-b' } },
            },
            'DeepPartial_with-b': {
              type: 'object',
              properties: { b: { $ref: '#/$defs/DeepPartial_with-c' } },
            },
            'DeepPartial_with-c': {
              type: 'object',
              properties: { c: { $ref: '#/$defs/DeepPartial_with-d' } },
            },
            'DeepPartial_with-d': {
              type: 'object',
              properties: { d: { $ref: '#/$defs/DeepPartial_with-e' } },
            },
            'DeepPartial_with-e': {
              type: 'object',
              properties: { e: { $ref: '#/$defs/DeepPartial_with-f' } },
            },
            'DeepPartial_with-f': {
              type: 'object',
              properties: { f: { $ref: '#/$defs/DeepPartial_with-g' } },
            },
            'DeepPartial_with-g': { type: 'object', properties: { g: { type: 'string' } } },
          },
        },
        false,
      ])
    })

    it('functions, constructors, hybrids, and Object', () => {
      expect(convertR2('FnProp')).toEqual([
        {
          $ref: '#/$defs/FnProp',
          $defs: {
            FnProp: {
              type: 'object',
              // `Object` also holds a function
              properties: { name: { type: 'string' }, data: {} },
              required: ['name'],
            },
          },
        },
        false,
      ])
    })

    it('subclasses of Map, Set, Array, Error, and typed arrays', () => {
      expect(convertR2('LibraryClasses')).toEqual([
        {
          $ref: '#/$defs/LibraryClasses',
          $defs: {
            LibraryClasses: {
              type: 'object',
              properties: {
                map: { $ref: '#/$defs/DefaultMap_string_number' },
                tags: { $ref: '#/$defs/Tags' },
                stack: { $ref: '#/$defs/Stack' },
                error: { $ref: '#/$defs/MyError' },
                plainError: { type: 'object' },
                // or a Buffer of the Node typings, written by its own `toJSON`
                bytes: {
                  anyOf: [
                    { type: 'object', additionalProperties: { type: 'number' } },
                    {
                      type: 'object',
                      properties: {
                        type: { type: 'string', const: 'Buffer' },
                        data: { type: 'array', items: { type: 'number' } },
                      },
                      required: ['type', 'data'],
                    },
                  ],
                },
              },
              required: ['map', 'tags', 'stack', 'error', 'plainError', 'bytes'],
            },
            MyError: {
              type: 'object',
              properties: { code: { type: 'number' } },
              required: ['code'],
            },
            Stack: { type: 'array', items: { type: 'number' } },
            Tags: {
              'type': 'array',
              'uniqueItems': true,
              'items': { type: 'string' },
              'x-native-type': 'set',
            },
            DefaultMap_string_number: {
              'type': 'array',
              'items': {
                type: 'array',
                prefixItems: [{ type: 'string' }, { type: 'number' }],
                maxItems: 2,
                minItems: 2,
              },
              'x-native-type': 'map',
            },
          },
        },
        false,
      ])
    })

    it('string index signatures win over number ones', () => {
      expect(convertR2('NumberIndexFirst')).toEqual([
        {
          $ref: '#/$defs/NumberIndexFirst',
          $defs: {
            NumberIndexFirst: {
              type: 'object',
              additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            },
          },
        },
        false,
      ])
    })

    it('template literal patterns match newlines', () => {
      expect(convertR2('Message')).toEqual([
        { type: 'string', pattern: '^Error: [\\s\\S]*$' },
        false,
      ])
    })

    it('deduplicates literals', () => {
      expect(convertR2('DuplicateLiterals')).toEqual([
        {
          $ref: '#/$defs/DuplicateLiterals',
          $defs: { DuplicateLiterals: { type: 'string', enum: ['a', 'c'] } },
        },
        false,
      ])
    })

    it('names generics with array and tuple arguments', () => {
      expect(convertR2('GenericNames')).toEqual([
        {
          $ref: '#/$defs/GenericNames',
          $defs: {
            GenericNames: {
              type: 'object',
              properties: {
                a: { $ref: '#/$defs/Page_AArray' },
                b: { $ref: '#/$defs/Page_BArray' },
                pair: { $ref: '#/$defs/Pair_A_B' },
              },
              required: ['a', 'b', 'pair'],
            },
            Pair_A_B: {
              type: 'object',
              properties: {
                pair: {
                  type: 'array',
                  prefixItems: [{ $ref: '#/$defs/A' }, { $ref: '#/$defs/B' }],
                  maxItems: 2,
                  minItems: 2,
                },
              },
              required: ['pair'],
            },
            B: { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
            A: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
            Page_BArray: {
              type: 'object',
              properties: {
                items: { type: 'array', items: { type: 'array', items: { $ref: '#/$defs/B' } } },
              },
              required: ['items'],
            },
            Page_AArray: {
              type: 'object',
              properties: {
                items: { type: 'array', items: { type: 'array', items: { $ref: '#/$defs/A' } } },
              },
              required: ['items'],
            },
          },
        },
        false,
      ])
    })

    it('applies JSDoc of primitive aliases', () => {
      expect(convertR2('PrimitiveAliases')).toEqual([
        {
          $ref: '#/$defs/PrimitiveAliases',
          $defs: {
            PrimitiveAliases: {
              type: 'object',
              properties: {
                count: { type: 'integer', description: 'An integer count', minimum: 0 },
                email: { anyOf: [{ type: 'string' }, { type: 'null' }], format: 'email' },
                described: { type: 'integer', description: 'Own description wins', minimum: 0 },
              },
              required: ['count', 'described'],
            },
          },
        },
        false,
      ])
    })

    it('single-member enums are components', () => {
      expect(convertR2('UsesKind')).toEqual([
        {
          $ref: '#/$defs/UsesKind',
          $defs: {
            UsesKind: {
              type: 'object',
              properties: { kind: { $ref: '#/$defs/Kind' } },
              required: ['kind'],
            },
            Kind: { type: 'string', const: 'only', description: 'The only kind' },
          },
        },
        false,
      ])
    })

    it('cuts growing instantiations without caching the cut', () => {
      const c = new TypeToJsonSchemaConverter(r2.checker, r2.program)
      const expected = [
        {
          $ref: '#/$defs/Expanded',
          $defs: {
            Expanded: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                next: { $ref: '#/$defs/Expand_stringArray' },
              },
              required: ['value'],
            },
            Expand_stringArray: {
              type: 'object',
              properties: {
                value: { type: 'array', items: { type: 'string' } },
                next: { $ref: '#/$defs/Expand_stringArrayArray' },
              },
              required: ['value'],
            },
            Expand_stringArrayArray: {
              type: 'object',
              properties: {
                value: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                next: { $ref: '#/$defs/Expand_stringArrayArrayArray' },
              },
              required: ['value'],
            },
            Expand_stringArrayArrayArray: {
              type: 'object',
              properties: {
                value: {
                  type: 'array',
                  items: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                },
                next: {},
              },
              required: ['value'],
            },
          },
        },
        false,
      ]
      expect(convertR2('Expanded', c)).toEqual(expected)
      // converted again, under fresh names: the first conversion emitted the others already
      expect(
        JSON.parse(
          JSON.stringify(convertR2('Expanded', c)).replaceAll(/(?<=[A-Za-z])2(?=")/gu, ''),
        ),
      ).toEqual(expected)
    })

    it('applies JSDoc of named types with defs: recursive', () => {
      const c = new TypeToJsonSchemaConverter(r2.checker, r2.program, { defs: 'recursive' })
      expect(convertR2('RecursiveHolder', c)).toEqual([
        {
          type: 'object',
          properties: {
            tree: { $ref: '#/$defs/DocTree' },
            plain: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
              description: 'A plain item',
            },
          },
          required: ['tree', 'plain'],
          $defs: {
            DocTree: {
              type: 'object',
              properties: { children: { type: 'array', items: { $ref: '#/$defs/DocTree' } } },
              required: ['children'],
              description: 'A documented tree',
              deprecated: true,
            },
          },
        },
        false,
      ])
      expect(convertR2('RecursiveHolder')).toEqual([
        {
          $ref: '#/$defs/RecursiveHolder',
          $defs: {
            RecursiveHolder: {
              type: 'object',
              properties: { tree: { $ref: '#/$defs/DocTree' }, plain: { $ref: '#/$defs/Plain' } },
              required: ['tree', 'plain'],
            },
            Plain: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
              description: 'A plain item',
            },
            DocTree: {
              type: 'object',
              properties: { children: { type: 'array', items: { $ref: '#/$defs/DocTree' } } },
              required: ['children'],
              description: 'A documented tree',
              deprecated: true,
            },
          },
        },
        false,
      ])
    })

    it('inlineRoot inlines a root def nothing else references', () => {
      const c = new TypeToJsonSchemaConverter(r2.checker, r2.program)
      const [schema] = c.convert(r2.getExportType('RecursiveHolder').type, {
        inlineRoot: true,
      }) as [any, boolean]
      expect(schema.type).toBe('object')
      expect(Object.keys(schema.$defs)).toEqual(expect.arrayContaining(['DocTree', 'Plain']))
      expect(schema.$defs.RecursiveHolder).toBeUndefined()

      // a recursive root stays a ref
      const [tree] = c.convert(r2.getExportType('DocTree').type, { inlineRoot: true }) as [
        any,
        boolean,
      ]
      expect(tree.$ref).toBe('#/$defs/DocTree')
    })
  })

  describe('regressions', () => {
    let reg: TypeScriptProject
    let loose: TypeScriptProject

    beforeAll(() => {
      reg = openTypeScriptProject({
        file: new URL('../tests/fixtures/types/src/regressions.ts', import.meta.url),
      })
      loose = openTypeScriptProject({
        file: new URL('../tests/fixtures/loose/src/types.ts', import.meta.url),
      })
    })

    afterAll(() => {
      reg.close()
      loose.close()
    })

    const convertIn = (p: TypeScriptProject, name: string, c?: TypeToJsonSchemaConverter) =>
      (c ?? new TypeToJsonSchemaConverter(p.checker, p.program)).convert(p.getExportType(name).type)

    it('tuples with rest elements in the middle, first, or optional undefined elements', () => {
      expect(convertIn(reg, 'RestInMiddle')).toEqual([
        {
          $ref: '#/$defs/RestInMiddle',
          $defs: {
            RestInMiddle: {
              type: 'array',
              prefixItems: [{ type: 'string' }],
              items: { anyOf: [{ type: 'number' }, { type: 'boolean' }] },
              minItems: 2,
            },
          },
        },
        false,
      ])
      expect(convertIn(reg, 'RestFirst')).toEqual([
        {
          $ref: '#/$defs/RestFirst',
          $defs: {
            RestFirst: {
              type: 'array',
              items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              minItems: 1,
            },
          },
        },
        false,
      ])
      expect(convertIn(reg, 'OptionalUndefinedElement')).toEqual([
        {
          $ref: '#/$defs/OptionalUndefinedElement',
          $defs: {
            OptionalUndefinedElement: {
              type: 'array',
              prefixItems: [{ type: 'string' }, { anyOf: [{ type: 'number' }, { type: 'null' }] }],
              maxItems: 2,
              minItems: 1,
            },
          },
        },
        false,
      ])
    })

    it('drops optional functions, symbols, and methods', () => {
      expect(convertIn(reg, 'OptionalNonSerializable')).toEqual([
        {
          $ref: '#/$defs/OptionalNonSerializable',
          $defs: {
            OptionalNonSerializable: {
              type: 'object',
              properties: { n: { type: 'number' } },
              required: ['n'],
            },
          },
        },
        false,
      ])
      expect(convertIn(reg, 'WithMethod')).toEqual([
        {
          $ref: '#/$defs/WithMethod',
          $defs: {
            WithMethod: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
          },
        },
        false,
      ])
      expect(convertIn(reg, 'PartialWithMethod')).toEqual([
        { type: 'object', properties: { a: { type: 'number' } } },
        false,
      ])
    })

    it('@type keeps null branches and refs', () => {
      expect(convertIn(reg, 'NullableInteger')).toEqual([
        {
          $ref: '#/$defs/NullableInteger',
          $defs: {
            NullableInteger: {
              type: 'object',
              properties: {
                age: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                user: { $ref: '#/$defs/User' },
              },
              required: ['age', 'user'],
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

    it('keeps quoted keys starting with __@ or #', () => {
      expect(convertIn(reg, 'SpecialKeys')).toEqual([
        {
          $ref: '#/$defs/SpecialKeys',
          $defs: {
            SpecialKeys: {
              type: 'object',
              properties: {
                '__typename': { type: 'string', const: 'User' },
                '__@odd': { type: 'number' },
                '#hash': { type: 'string' },
              },
              required: ['__typename', '__@odd', '#hash'],
            },
          },
        },
        false,
      ])
    })

    it('does not convert ignored index signatures', () => {
      expect(convertIn(reg, 'SymbolIndex')).toEqual([
        {
          $ref: '#/$defs/SymbolIndex',
          $defs: {
            SymbolIndex: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          },
        },
        false,
      ])
    })

    it('branded built-ins and computed enums', () => {
      expect(convertIn(reg, 'BrandedDate')).toEqual([
        { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
        false,
      ])
      expect(convertIn(reg, 'Computed')).toEqual([{ type: 'number' }, false])
    })

    it('rolls back defs of a failed conversion', () => {
      const c = new TypeToJsonSchemaConverter(reg.checker, reg.program)
      expect(() => convertIn(reg, 'WithMissing', c)).toThrow('Could not resolve the type "Missing"')
      expect(() => convertIn(reg, 'WithMissing', c)).toThrow('Could not resolve the type "Missing"')
      expect(() => convertIn(reg, 'HoldsMissing', c)).toThrow(
        'Could not resolve the type "Missing"',
      )
      expect(convertIn(reg, 'Computed', c)).toEqual([{ type: 'number' }, false])
    })

    it('stops infinitely expanding generics', () => {
      const [schema] = convertIn(reg, 'Expanded') as [any, boolean]
      const defs = Object.values(schema.$defs) as any[]
      expect(defs.length).toBeLessThanOrEqual(6)
      expect(defs.some((def) => JSON.stringify(def.properties.next) === '{}')).toBe(true)
    })

    it('void unions without strictNullChecks', () => {
      expect(convertIn(loose, 'StringOrVoid')).toEqual([{ type: 'string' }, true])
      expect(convertIn(loose, 'Loose')).toEqual([
        {
          $ref: '#/$defs/Loose',
          $defs: {
            Loose: {
              type: 'object',
              properties: { p: { type: 'string' }, n: { type: 'number' } },
              required: ['n'],
            },
          },
        },
        false,
      ])
    })
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
              description: 'A registered user',
            },
            other: {
              type: 'object',
              properties: { email: { type: 'string' } },
              required: ['email'],
              description: 'Another user, with the same name',
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

    it('awaits promises in unions', () => {
      expect(create().convert(edge.getExportType('PromiseOrValue').type)).toEqual([
        {
          anyOf: [
            { type: 'string', const: 'x' },
            { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
          ],
        },
        false,
      ])
    })

    it('getAsyncIteratorTypes', () => {
      const c = create()
      const toString = (name: string) => {
        const types = c.getAsyncIteratorTypes(edge.getExportType(name).type)
        return (
          types &&
          [types.yieldTypes, types.returnTypes].map((list) =>
            list.map((t) => edge.checker.typeToString(t)),
          )
        )
      }

      expect(toString('Gen')).toEqual([['{ n: number; }'], ['"done"']])
      expect(toString('Iter')).toEqual([['string'], ['any']])
      expect(toString('IterObject')).toEqual([['number'], []])
      // members in the checker's order, `any` is the default return of `AsyncGenerator<string>`
      expect(toString('GenOrNull')).toEqual([
        ['string', '{ n: number; }'],
        ['any', '"done"'],
      ])
      expect(toString('ManyResults')).toEqual([['{ a: number; }', '{ b: string; }'], []])
      // asked once per type
      const c2 = create()
      const gen = edge.getExportType('GenOrNull').type
      c2.getAsyncIteratorTypes(gen)
      const spy = vi.spyOn(edge.checker, 'getTypeOfSymbol')
      c2.getAsyncIteratorTypes(gen)
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()

      expect(toString('NotIter')).toBeUndefined()
      expect(toString('BothUsers')).toBeUndefined()
    })
  })

  describe('types no handler returns', () => {
    it('converts types no handler returns as a value of their own', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/app/src/client-values.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program, {
          defs: 'recursive',
        })
        const convert = (name: string) => converter.convert(project.getExportType(name).type)

        // like `object`, also a function, which is written as nothing
        expect(convert('AnyRecord')).toEqual([
          { description: 'Any object, an array or a function too' },
          true,
        ])
        expect(convert('StringIterable')).toEqual([
          { description: 'Strings, as an array, a set, or a string' },
          false,
        ])
      } finally {
        project.close()
      }
    })
  })

  describe('a polyfilled BigInt toJSON', () => {
    it('writes a boxed BigInt through its polyfilled toJSON', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/augmented/src/index.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        const [schema] = converter.convert(project.getExportType('BoxedBigInts').type) as [
          any,
          boolean,
        ]
        const bigint = { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' }

        expect(schema.$defs.BoxedBigInts.properties).toEqual({
          n: bigint,
          // `BigInt` also describes bigints, a boxed one is written by `JSON.stringify`
          boxed: { anyOf: [bigint, { type: 'string' }] },
        })
      } finally {
        project.close()
      }
    })
  })

  describe('functions with an optional toJSON', () => {
    it('makes a function with an optional toJSON optional, at the root too', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/app/src/deep-views.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        const [schema, optional] = converter.convert(project.getExportType('FnMaybeJSON').type)

        expect(schema).toEqual({
          type: 'string',
          description: 'A function JSON writes by its `toJSON` when it has one, else as nothing',
        })
        expect(optional).toBe(true)
      } finally {
        project.close()
      }
    })
  })

  describe('aliases of library models', () => {
    const record = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        authorId: { type: 'number' },
      },
      required: ['id', 'title', 'authorId'],
    }

    it('names a model after the alias the file of a property holding it imports', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/library-aliases/src/feed.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)

        expect(converter.convert(project.getExportType('Feed').type)).toEqual([
          {
            $ref: '#/$defs/Feed',
            $defs: {
              Feed: {
                type: 'object',
                properties: {
                  latest: { anyOf: [{ $ref: '#/$defs/PostRecord' }, { type: 'null' }] },
                },
                required: ['latest'],
              },
              PostRecord: record,
            },
          },
          false,
        ])
      } finally {
        project.close()
      }
    })

    it('names a model after an alias of the files read before', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/library-aliases/src/models.ts', import.meta.url),
      })

      try {
        const exported = project.getExportType('PostRecord')

        // the library declares its fields, no file read declares or imports the alias
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        expect(converter.convert(exported.type)).toEqual([record, false])

        const reading = new TypeToJsonSchemaConverter(project.checker, project.program)
        reading.readAliases(exported.symbol.declarations)
        expect(reading.convert(exported.type)).toEqual([
          { $ref: '#/$defs/PostRecord', $defs: { PostRecord: record } },
          false,
        ])
      } finally {
        project.close()
      }
    })
  })

  describe('views of functions and bigint typed arrays', () => {
    it('makes a view of a function optional, at the root too', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/app/src/deep-views.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        const [schema, optional] = converter.convert(project.getExportType('FnPropsView').type)

        expect(schema).toEqual({
          type: 'object',
          properties: { tag: { type: 'string' } },
          required: ['tag'],
        })
        expect(optional).toBe(true)
      } finally {
        project.close()
      }
    })

    it('writes the items of bigint typed arrays through a polyfilled toJSON', () => {
      const project = openTypeScriptProject({
        file: new URL('../tests/fixtures/augmented/src/index.ts', import.meta.url),
      })

      try {
        const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
        const [schema] = converter.convert(project.getExportType('BigIntArrays').type) as [
          any,
          boolean,
        ]
        const items = { type: 'object', additionalProperties: { type: 'string' } }

        expect(schema.$defs.BigIntArrays.properties).toEqual({ signed: items, unsigned: items })
      } finally {
        project.close()
      }
    })
  })

  describe('discriminators', () => {
    const ref = (name: string) => ({ $ref: `#/$defs/${name}` })
    const discriminated = (propertyName: string, mapping: Record<string, string>) => ({
      oneOf: [...new Set(Object.values(mapping))].map((name) => ref(name)),
      discriminator: {
        propertyName,
        mapping: Object.fromEntries(
          Object.entries(mapping).map(([value, name]) => [value, `#/$defs/${name}`]),
        ),
      },
    })

    let project: TypeScriptProject
    let defsOf: (name: string, direction?: 'input' | 'output') => Record<string, any>

    beforeAll(() => {
      project = openTypeScriptProject({
        file: new URL('../tests/fixtures/app/src/discriminated-unions.ts', import.meta.url),
      })
      const converters = {
        input: new TypeToJsonSchemaConverter(project.checker, project.program, {
          direction: 'input',
        }),
        output: new TypeToJsonSchemaConverter(project.checker, project.program),
      }
      defsOf = (name, direction = 'output') =>
        (converters[direction].convert(project.getExportType(name).type)[0] as any).$defs
    })

    afterAll(() => {
      project.close()
    })

    it('writes a union of models told apart by a literal property with a discriminator', () => {
      expect(defsOf('Shape').Shape).toEqual({
        description: 'A shape, told apart by its kind',
        ...discriminated('kind', { circle: 'Circle', square: 'Square' }),
      })
      // a model of several kinds, and kinds of enum members
      expect(defsOf('Rounded').Rounded).toEqual(
        discriminated('kind', { circle: 'Ellipse', ellipse: 'Ellipse', square: 'Square' }),
      )
      expect(defsOf('KindEnumShape').KindEnumShape).toEqual(
        discriminated('kind', { flat: 'FlatShape', round: 'RoundShape' }),
      )
    })

    it('discriminates by the kinds as serialized', () => {
      // `toJSON` writes another kind, which a client sends for an instance, not for a plain object
      expect(defsOf('RelabelledShape').RelabelledShape).toEqual(
        discriminated('kind', { renamed: 'Relabelled', square: 'Square' }),
      )
      expect(defsOf('RelabelledShape', 'input').RelabelledShape).toEqual({
        anyOf: [ref('Relabelled'), ref('Square')],
      })
    })

    it('does not discriminate unions whose members can not be told apart by a property', () => {
      // kinds that clash, a kind that may be left out, and a member that is no model
      expect(defsOf('Clashing').Clashing).toEqual({ anyOf: [ref('Circle'), ref('Disc')] })
      expect(defsOf('MaybeKinds').MaybeKinds).toEqual({ anyOf: [ref('MaybeKind'), ref('Square')] })
      expect(defsOf('ShapeOrText').ShapeOrText).toEqual({
        anyOf: [{ type: 'string' }, ref('Circle'), ref('Square')],
      })
      // a view of a class is an instance, written by `toJSON` with another kind, or a plain object
      expect(defsOf('LabelledView').LabelledView.anyOf).toEqual([
        {
          anyOf: [
            expect.objectContaining({ properties: { kind: { type: 'string', const: 'json' } } }),
            expect.objectContaining({
              properties: { kind: { type: 'string', const: 'labelled' } },
            }),
          ],
        },
        ref('Square'),
      ])
    })

    it('discriminates a recursive union however it is reached', () => {
      const tree = discriminated('kind', { branch: 'Branch', leaf: 'Leaf' })
      expect(defsOf('Branch').Tree).toEqual({ description: 'A tree of leaves', ...tree })
      expect(defsOf('Tree').Tree).toEqual({ description: 'A tree of leaves', ...tree })
    })

    it('does not discriminate members inlined at the root', () => {
      const converter = new TypeToJsonSchemaConverter(project.checker, project.program)
      const [schema] = converter.convert(project.getExportType('Shape').type, { inlineRoot: true })

      expect(schema).toEqual({
        description: 'A shape, told apart by its kind',
        anyOf: [
          expect.objectContaining({ type: 'object', required: ['kind', 'radius'] }),
          expect.objectContaining({ type: 'object', required: ['kind', 'size'] }),
        ],
      })
    })
  })
})
