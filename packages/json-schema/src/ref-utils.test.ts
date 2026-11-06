import {
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  hoistRecursiveRefToDef,
  mapJsonSchemaRefs,
  resolveJsonSchemaLocalPointer,
  resolveJsonSchemaRootLocalRef,
  visitJsonSchemaRefs,
} from './ref-utils.ts'
import type { JsonSchema } from './types.ts'

describe('visitJsonSchemaRefs', () => {
  it('visits refs under the same keywords mapJsonSchemaRefs rewrites, and skips non-schema keywords', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        child: { $ref: '#/$defs/A' },
        unmapped: { discriminator: { propertyName: 'kind' } },
        // malformed discriminators are skipped
        malformed: { discriminator: 'kind' as any },
      },
      patternProperties: { '^x-': { $ref: '#/$defs/B' } },
      propertyNames: { $ref: '#/$defs/C' },
      dependentSchemas: { other: { $ref: '#/$defs/D' } },
      contains: { $ref: '#/$defs/E' },
      prefixItems: [{ $ref: '#/$defs/F' }],
      not: { $ref: '#/$defs/G' },
      if: { $ref: '#/$defs/H' },
      // oxlint-disable-next-line unicorn/no-thenable
      then: { $ref: '#/$defs/I' },
      else: { $ref: '#/$defs/J' },
      items: { $ref: '#/$defs/K' },
      additionalProperties: { $ref: '#/$defs/L' },
      anyOf: [{ $ref: '#/$defs/M' }],
      $defs: { Nested: { $ref: '#/$defs/N' } },
      discriminator: {
        propertyName: 'kind',
        mapping: { o: '#/$defs/O', bare: 'Bare', remote: 'other.json#/Remote' },
        defaultMapping: '#/$defs/P',
      },
      examples: [{ $ref: '#/$defs/Ignored' }],
    }

    const mapped: string[] = []
    mapJsonSchemaRefs(schema, (ref) => {
      mapped.push(ref)
      return ref
    })

    const visited: string[] = []
    visitJsonSchemaRefs(schema, (ref) => visited.push(ref))

    expect(visited.toSorted()).toEqual(mapped.toSorted())
    expect(visited).not.toContain('#/$defs/Ignored')
    expect(visited).not.toContain('Bare')
    expect(visited).not.toContain('other.json#/Remote')
    expect(visited.length).toBe(16)
  })

  it('visits shared and cyclic object instances once', () => {
    const shared: JsonSchema = { $ref: '#/$defs/Shared' }
    const cyclic: Record<string, unknown> = { type: 'object' }
    cyclic.items = cyclic

    const visited: string[] = []
    visitJsonSchemaRefs(
      {
        type: 'object',
        properties: {
          a: shared,
          b: shared,
          c: cyclic as JsonSchema,
        },
      },
      (ref) => visited.push(ref),
    )

    expect(visited).toEqual(['#/$defs/Shared'])
  })

  it('ignores non-object schemas', () => {
    const visited: string[] = []
    visitJsonSchemaRefs(true, (ref) => visited.push(ref))
    visitJsonSchemaRefs(false, (ref) => visited.push(ref))
    expect(visited).toEqual([])
  })
})

describe('json pointer utils', () => {
  it('encodes and decodes JSON pointer segments', () => {
    expect(encodeJsonPointerSegment('a~/b')).toBe('a~0~1b')
    expect(decodeJsonPointerSegment('a~0~1b')).toBe('a~/b')
  })
})

describe('resolveJsonSchemaLocalPointer', () => {
  const root: JsonSchema = {
    type: 'object',
    properties: { 'a/b': { type: 'string' } },
    $defs: { User: { type: 'object' } },
  }

  it('resolves root and absolute local pointers', () => {
    expect(resolveJsonSchemaLocalPointer(root, '#')).toBe(root)
    expect(resolveJsonSchemaLocalPointer(root, '#/$defs/User')).toEqual({ type: 'object' })
    expect(resolveJsonSchemaLocalPointer(root, '#/properties/a~1b')).toEqual({ type: 'string' })
  })

  it('returns undefined for missing targets and non-local refs', () => {
    expect(resolveJsonSchemaLocalPointer(root, '#/$defs/Missing')).toBeUndefined()
    expect(resolveJsonSchemaLocalPointer(root, 'https://example.com/schema')).toBeUndefined()
    expect(resolveJsonSchemaLocalPointer(root, '#anchor')).toBeUndefined()
  })
})

describe('mapJsonSchemaRefs', () => {
  it('passes the structural path to the mapper', () => {
    const visited: Array<[ref: string, path: Array<string | number>]> = []

    const schema = mapJsonSchemaRefs(
      {
        type: 'object',
        properties: {
          child: { $ref: '#/$defs/Node' },
        },
        anyOf: [{ $ref: '#/$defs/Leaf' }],
        examples: [{ $ref: '#/$defs/Ignored' }],
      },
      (ref, path) => {
        visited.push([ref, path])
        return ref
      },
    )

    expect(schema).toEqual({
      type: 'object',
      properties: {
        child: { $ref: '#/$defs/Node' },
      },
      anyOf: [{ $ref: '#/$defs/Leaf' }],
      examples: [{ $ref: '#/$defs/Ignored' }],
    })

    expect(visited).toEqual([
      ['#/$defs/Node', ['properties', 'child', '$ref']],
      ['#/$defs/Leaf', ['anyOf', 0, '$ref']],
    ])
  })

  it('rewrites refs across schema arrays and schema record keywords', () => {
    const visited: Array<[ref: string, path: Array<string | number>]> = []

    const rewritten = mapJsonSchemaRefs(
      {
        anyOf: [
          { $ref: '#/$defs/Node' },
          {
            properties: {
              child: { $ref: '#/$defs/Child' },
            },
          },
        ],
        $defs: {
          Node: {
            items: { $ref: '#/$defs/Leaf' },
          },
        },
        dependentSchemas: {
          feature: { $ref: '#/$defs/Feature' },
        },
      },
      (ref, path) => {
        visited.push([ref, path])
        return `${ref}?visited=${path.join('.')}`
      },
    )

    expect(rewritten).toEqual({
      anyOf: [
        { $ref: '#/$defs/Node?visited=anyOf.0.$ref' },
        {
          properties: {
            child: { $ref: '#/$defs/Child?visited=anyOf.1.properties.child.$ref' },
          },
        },
      ],
      $defs: {
        Node: {
          items: { $ref: '#/$defs/Leaf?visited=$defs.Node.items.$ref' },
        },
      },
      dependentSchemas: {
        feature: { $ref: '#/$defs/Feature?visited=dependentSchemas.feature.$ref' },
      },
    })

    expect(visited).toEqual([
      ['#/$defs/Node', ['anyOf', 0, '$ref']],
      ['#/$defs/Child', ['anyOf', 1, 'properties', 'child', '$ref']],
      ['#/$defs/Leaf', ['$defs', 'Node', 'items', '$ref']],
      ['#/$defs/Feature', ['dependentSchemas', 'feature', '$ref']],
    ])
  })

  it('ignores non-schema metadata while still traversing nested schemas', () => {
    const visited: Array<[ref: string, path: Array<string | number>]> = []

    const rewritten = mapJsonSchemaRefs(
      {
        type: 'object',
        title: 'Example',
        examples: [{ $ref: '#/$defs/Ignored' }],
        default: {
          $ref: '#/$defs/AlsoIgnored',
        },
        properties: {
          nested: {
            allOf: [{ $ref: '#/$defs/Tracked' }],
          },
        },
      },
      (ref, path) => {
        visited.push([ref, path])
        return ref.replace('#/$defs/', '#/$defs/rewritten-')
      },
    )

    expect(rewritten).toEqual({
      type: 'object',
      title: 'Example',
      examples: [{ $ref: '#/$defs/Ignored' }],
      default: {
        $ref: '#/$defs/AlsoIgnored',
      },
      properties: {
        nested: {
          allOf: [{ $ref: '#/$defs/rewritten-Tracked' }],
        },
      },
    })

    expect(visited).toEqual([['#/$defs/Tracked', ['properties', 'nested', 'allOf', 0, '$ref']]])
  })

  it('rewrites local pointers in discriminator mapping values and leaves other values alone', () => {
    const visited: Array<[ref: string, path: Array<string | number>]> = []
    const discriminatorWithoutRefs = { propertyName: 'kind', mapping: { dog: 'Dog' } }
    const discriminatorWithoutMapping = { propertyName: 'kind' }

    const rewritten = mapJsonSchemaRefs(
      {
        properties: {
          pet: {
            oneOf: [{ $ref: '#/$defs/Cat' }, { $ref: '#/$defs/Dog' }],
            discriminator: {
              'propertyName': 'kind',
              'mapping': { cat: '#/$defs/Cat', dog: 'Dog', remote: 'other.json#/Bird' },
              'defaultMapping': '#/$defs/Dog',
              'x-extra': true,
            },
          },
          plain: { discriminator: discriminatorWithoutRefs },
          unmapped: { discriminator: discriminatorWithoutMapping },
          defaultOnly: { discriminator: { propertyName: 'kind', defaultMapping: '#/$defs/Cat' } },
          // malformed discriminators are kept as is
          malformed: { discriminator: 'kind' as any },
        },
        // discriminator-shaped metadata is not a schema keyword here
        examples: [{ discriminator: { mapping: { cat: '#/$defs/Cat' } } }],
      },
      (ref, path) => {
        visited.push([ref, path])
        return ref.replace('#/$defs/', '#/components/schemas/')
      },
    )

    expect(rewritten).toEqual({
      properties: {
        pet: {
          oneOf: [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Dog' }],
          discriminator: {
            'propertyName': 'kind',
            'mapping': {
              cat: '#/components/schemas/Cat',
              dog: 'Dog',
              remote: 'other.json#/Bird',
            },
            'defaultMapping': '#/components/schemas/Dog',
            'x-extra': true,
          },
        },
        plain: { discriminator: discriminatorWithoutRefs },
        unmapped: { discriminator: discriminatorWithoutMapping },
        defaultOnly: {
          discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/Cat' },
        },
        malformed: { discriminator: 'kind' },
      },
      examples: [{ discriminator: { mapping: { cat: '#/$defs/Cat' } } }],
    })
    expect((rewritten as any).properties.plain.discriminator).toBe(discriminatorWithoutRefs)
    expect((rewritten as any).properties.unmapped.discriminator).toBe(discriminatorWithoutMapping)

    expect(visited).toEqual([
      ['#/$defs/Cat', ['properties', 'pet', 'oneOf', 0, '$ref']],
      ['#/$defs/Dog', ['properties', 'pet', 'oneOf', 1, '$ref']],
      ['#/$defs/Cat', ['properties', 'pet', 'discriminator', 'mapping', 'cat']],
      ['#/$defs/Dog', ['properties', 'pet', 'discriminator', 'defaultMapping']],
      ['#/$defs/Cat', ['properties', 'defaultOnly', 'discriminator', 'defaultMapping']],
    ])
  })

  it('keeps properties and defs named __proto__ as own keys', () => {
    const rewritten = mapJsonSchemaRefs(
      JSON.parse(
        '{"properties":{"__proto__":{"$ref":"#/$defs/__proto__"}},"$defs":{"__proto__":{"type":"string"}}}',
      ),
      (ref) => ref.replace('#/$defs/', '#/$defs/rewritten-'),
    )

    expect(JSON.stringify(rewritten)).toBe(
      '{"properties":{"__proto__":{"$ref":"#/$defs/rewritten-__proto__"}},"$defs":{"__proto__":{"type":"string"}}}',
    )
  })
})

describe('resolveJsonSchemaRootLocalRef', () => {
  it('returns unsupported refs unchanged', () => {
    const schemaWithoutRef: JsonSchema = { type: 'string' }
    const externalRef: JsonSchema = {
      $ref: '#/components/schemas/User',
      $defs: { User: { type: 'string' } },
    }
    const missingDefs: JsonSchema = { $ref: '#/$defs/User' } as JsonSchema
    const nullDefs: JsonSchema = { $ref: '#/$defs/User', $defs: null as never }

    expect(resolveJsonSchemaRootLocalRef(true)).toBe(true)
    expect(resolveJsonSchemaRootLocalRef(schemaWithoutRef)).toBe(schemaWithoutRef)
    expect(resolveJsonSchemaRootLocalRef(externalRef)).toBe(externalRef)
    expect(resolveJsonSchemaRootLocalRef(missingDefs)).toBe(missingDefs)
    expect(resolveJsonSchemaRootLocalRef(nullDefs)).toBe(nullDefs)
  })

  it('returns the original schema when the ref path cannot be resolved', () => {
    const walksIntoNonObject: JsonSchema = {
      $ref: '#/$defs/branch/leaf',
      $defs: {
        branch: true,
      },
    }

    const missingTarget: JsonSchema = {
      $ref: '#/$defs/missing',
      $defs: {},
    }

    expect(resolveJsonSchemaRootLocalRef(walksIntoNonObject)).toBe(walksIntoNonObject)
    expect(resolveJsonSchemaRootLocalRef(missingTarget)).toBe(missingTarget)
  })

  it('resolves boolean and nested object refs from $defs', () => {
    const escapedKey = 'a~/b'
    const encodedKey = encodeJsonPointerSegment(escapedKey)

    const booleanRef: JsonSchema = {
      $ref: '#/$defs/flag',
      $defs: {
        flag: false,
      },
    }

    const recursiveRef: JsonSchema = {
      $ref: '#/$defs/outer',
      description: 'top level description',
      examples: ['example'],
      $defs: {
        outer: {
          $ref: `#/$defs/${encodedKey}`,
          title: 'outer title',
        },
        [escapedKey]: {
          type: 'string',
          minLength: 1,
        },
      },
    }

    const truthyBooleanRef: JsonSchema = {
      $ref: '#/$defs/flag',
      title: 'kept',
      $defs: {
        flag: true,
      },
    }

    expect(resolveJsonSchemaRootLocalRef(booleanRef)).toEqual(false)
    expect(resolveJsonSchemaRootLocalRef(truthyBooleanRef)).toEqual(true)
    expect(resolveJsonSchemaRootLocalRef(recursiveRef)).toEqual({
      type: 'string',
      minLength: 1,
      title: 'outer title',
      description: 'top level description',
      examples: ['example'],
      $defs: {
        outer: {
          $ref: `#/$defs/${encodedKey}`,
          title: 'outer title',
        },
        [escapedKey]: {
          type: 'string',
          minLength: 1,
        },
      },
    })
  })

  it('stops at the first repeated ref in a cycle', () => {
    const schema: JsonSchema = {
      $ref: '#/$defs/A',
      description: 'root',
      $defs: {
        A: { $ref: '#/$defs/B', title: 'A' },
        B: { $ref: '#/$defs/A' },
      },
    }

    expect(resolveJsonSchemaRootLocalRef(schema)).toEqual({ ...schema, title: 'A' })
  })

  it('follows chained refs through the $defs arg', () => {
    expect(
      resolveJsonSchemaRootLocalRef(
        { $ref: '#/$defs/outer' },
        {
          outer: { $ref: '#/$defs/inner', title: 'outer' },
          inner: { type: 'string' },
        },
      ),
    ).toEqual({ type: 'string', title: 'outer' })
  })

  it('prefer $defs arg over schema.$defs even undefined', () => {
    const schema: JsonSchema = {
      $ref: '#/$defs/branch',
      $defs: {
        branch: true,
      },
    }

    expect(
      resolveJsonSchemaRootLocalRef(schema, {
        branch: false,
      }),
    ).toEqual(false)
    expect(resolveJsonSchemaRootLocalRef(schema, undefined)).toBe(schema)
  })
})

describe('hoistRecursiveRefToDef', () => {
  it('returns schemas without recursive refs unchanged', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        child: { $ref: '#/$defs/Node' },
        lib: { $ref: '#/nonExists' },
      },
      $defs: {
        Node: { type: 'string' },
      },
    }

    expect(hoistRecursiveRefToDef(true)).toBe(true)
    expect(hoistRecursiveRefToDef(schema)).toBe(schema)
  })

  it('moves # refs into a generated $defs entry', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        value: { type: 'string' },
        child: { $ref: '#' },
        leaf: { $ref: '#/$defs/Leaf' },
        nested: { type: 'object', properties: { parent: { $ref: '#' } } },
      },
      required: ['value', 'child'],
      $defs: {
        Leaf: {
          anyOf: [{ type: 'null' }, { $ref: '#' }],
        },
      },
    }

    expect(hoistRecursiveRefToDef(schema)).toEqual({
      $ref: '#/$defs/__schema0',
      $defs: {
        Leaf: {
          anyOf: [{ type: 'null' }, { $ref: '#/$defs/__schema0' }],
        },
        __schema0: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            child: { $ref: '#/$defs/__schema0' },
            leaf: { $ref: '#/$defs/Leaf' },
            nested: { type: 'object', properties: { parent: { $ref: '#/$defs/__schema0' } } },
          },
          required: ['value', 'child'],
        },
      },
    })
  })

  it('uses the next available generated name when $defs already contains one', () => {
    const schema: JsonSchema = {
      type: 'array',
      items: { $ref: '#' },
      $defs: {
        __schema0: { type: 'string' },
      },
    }

    expect(hoistRecursiveRefToDef(schema)).toEqual({
      $ref: '#/$defs/__schema1',
      $defs: {
        __schema0: { type: 'string' },
        __schema1: {
          type: 'array',
          items: { $ref: '#/$defs/__schema1' },
        },
      },
    })
  })

  it('hoists partial recursive local refs into the generated $defs schema', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        one: { type: 'string' },
        twp: { $ref: '#/properties/one' },
        non_exists: { $ref: '#/nonExists' },
      },
      required: ['value', 'child'],
    }

    expect(hoistRecursiveRefToDef(schema)).toEqual({
      $ref: '#/$defs/__schema0',
      $defs: {
        __schema0: {
          type: 'object',
          properties: {
            one: { type: 'string' },
            twp: { $ref: '#/$defs/__schema0/properties/one' },
            non_exists: { $ref: '#/nonExists' },
          },
          required: ['value', 'child'],
        },
      },
    })
  })

  it('preserves escaped JSON pointer segments when hoisting partial recursive local refs', () => {
    const slashKey = 'a/b'
    const tildeKey = 'a~b'
    const encodedSlashKey = encodeJsonPointerSegment(slashKey)

    const schema: JsonSchema = {
      type: 'object',
      properties: {
        [slashKey]: { type: 'string' },
        nested: {
          type: 'object',
          properties: {
            [tildeKey]: { $ref: `#/properties/${encodedSlashKey}` },
          },
        },
      },
    }

    expect(hoistRecursiveRefToDef(schema)).toEqual({
      $ref: '#/$defs/__schema0',
      $defs: {
        __schema0: {
          type: 'object',
          properties: {
            [slashKey]: { type: 'string' },
            nested: {
              type: 'object',
              properties: {
                [tildeKey]: { $ref: `#/$defs/__schema0/properties/${encodedSlashKey}` },
              },
            },
          },
        },
      },
    })
  })
})
