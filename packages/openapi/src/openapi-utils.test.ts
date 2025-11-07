import type { OpenAPI } from '@orpc/contract'
import type { FileSchema, JSONSchema, ObjectSchema } from './schema'
import {
  checkParamsSchema,
  resolveOpenAPIJsonSchemaRef,
  simplifyComposedObjectJsonSchemasAndRefs,
  toOpenAPIContent,
  toOpenAPIEventIteratorContent,
  toOpenAPIMethod,
  toOpenAPIParameters,
  toOpenAPIPath,
  toOpenAPISchema,
} from './openapi-utils'

it('toOpenAPIPath', () => {
  expect(toOpenAPIPath('/path')).toBe('/path')
  expect(toOpenAPIPath('/path//{id}')).toBe('/path/{id}')
  expect(toOpenAPIPath('/path//to/{+id}')).toBe('/path/to/{id}')
  expect(toOpenAPIPath('//path//{+id}//something{+id}//')).toBe('/path/{id}/something{+id}')
})

it('toOpenAPIMethod', () => {
  expect(toOpenAPIMethod('GET')).toBe('get')
  expect(toOpenAPIMethod('POST')).toBe('post')
  expect(toOpenAPIMethod('PUT')).toBe('put')
  expect(toOpenAPIMethod('DELETE')).toBe('delete')
  expect(toOpenAPIMethod('PATCH')).toBe('patch')
})

describe('toOpenAPIContent', () => {
  const fileSchema: FileSchema = { type: 'string', contentMediaType: 'image/png' }

  it('normal schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
      required: ['a'],
    }

    expect(toOpenAPIContent(schema)).toEqual({
      'application/json': {
        schema,
      },
    })
  })

  it('body can be file schema', () => {
    expect(toOpenAPIContent(fileSchema)).toEqual({
      'image/png': {
        schema: fileSchema,
      },
    })

    expect(toOpenAPIContent({
      anyOf: [
        fileSchema,
        { type: 'number' },
      ],
    })).toEqual({
      'image/png': {
        schema: fileSchema,
      },
      'application/json': {
        schema: { type: 'number' },
      },
    })
  })

  it('body contain file schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
        c: fileSchema,
      },
      required: ['a'],
    }

    expect(toOpenAPIContent(schema)).toEqual({
      'application/json': {
        schema,
      },
      'multipart/form-data': {
        schema,
      },
    })
  })
})

describe('toOpenAPIEventIteratorContent', () => {
  it('required yields & not required returns', () => {
    expect(toOpenAPIEventIteratorContent([true, { type: 'string' }], [false, { type: 'number' }])).toEqual({
      'text/event-stream': {
        schema: {
          oneOf: [
            {
              type: 'object',
              properties: {
                event: { const: 'message' },
                data: { type: 'string' },
                id: { type: 'string' },
                retry: { type: 'number' },
              },
              required: ['event', 'data'],
            },
            {
              type: 'object',
              properties: {
                event: { const: 'done' },
                data: { type: 'number' },
                id: { type: 'string' },
                retry: { type: 'number' },
              },
              required: ['event'],
            },
            {
              type: 'object',
              properties: {
                event: { const: 'error' },
                data: {},
                id: { type: 'string' },
                retry: { type: 'number' },
              },
              required: ['event'],
            },
          ],
        },
      },
    })
  })

  it('not required yields & required returns', () => {
    expect(toOpenAPIEventIteratorContent([false, { type: 'string' }], [true, { type: 'number' }])).toEqual({
      'text/event-stream': {
        schema: {
          oneOf: [
            {
              type: 'object',
              properties: {
                event: { const: 'message' },
                data: { type: 'string' },
                id: { type: 'string' },
                retry: { type: 'number' },
              },
              required: ['event'],
            },
            {
              type: 'object',
              properties: {
                event: { const: 'done' },
                data: { type: 'number' },
                id: { type: 'string' },
                retry: { type: 'number' },
              },
              required: ['event', 'data'],
            },
            {
              type: 'object',
              properties: {
                event: { const: 'error' },
                data: {},
                id: { type: 'string' },
                retry: { type: 'number' },
              },
              required: ['event'],
            },
          ],
        },
      },
    })
  })
})

describe('toOpenAPIParameters', () => {
  const schema: ObjectSchema = {
    type: 'object',
    properties: {
      a: { type: 'string' },
      b: {
        type: 'object',
        properties: {
          b1: { type: 'number' },
          b2: { type: 'string' },
        },
        required: ['b1'],
      },
      c: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
    },
    required: ['a', 'c'],
  }

  it('normal', () => {
    expect(toOpenAPIParameters(schema, 'path')).toEqual([{
      name: 'a',
      in: 'path',
      required: true,
      schema: {
        type: 'string',
      },
    }, {
      name: 'b',
      in: 'path',
      required: false,
      schema: {
        type: 'object',
        properties: {
          b1: { type: 'number' },
          b2: { type: 'string' },
        },
        required: ['b1'],
      },
    }, {
      name: 'c',
      in: 'path',
      required: true,
      schema: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
    }])
  })

  it('query', () => {
    expect(toOpenAPIParameters(schema, 'query')).toEqual([{
      name: 'a',
      in: 'query',
      required: true,
      schema: {
        type: 'string',
      },
      allowEmptyValue: true,
      allowReserved: true,
    }, {
      name: 'b',
      in: 'query',
      required: false,
      explode: true,
      style: 'deepObject',
      schema: {
        type: 'object',
        properties: {
          b1: { type: 'number' },
          b2: { type: 'string' },
        },
        required: ['b1'],
      },
      allowEmptyValue: true,
      allowReserved: true,
    }, {
      name: 'c',
      in: 'query',
      required: true,
      schema: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      allowEmptyValue: true,
      allowReserved: true,
    }])
  })
})

describe('checkParamsSchema', () => {
  it('missing properties', () => {
    const schema: ObjectSchema = {
      type: 'object',
      required: ['a', 'b'],
    }

    expect(checkParamsSchema(schema, ['a', 'b'])).toBe(false)
  })

  it('redundant properties', () => {
    const schema: ObjectSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['a', 'b'],
    }

    expect(checkParamsSchema(schema, ['a'])).toBe(false)
  })

  it('missing required', () => {
    const schema: ObjectSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
    }

    expect(checkParamsSchema(schema, ['a', 'b'])).toBe(false)
  })

  it('redundant required', () => {
    const schema: ObjectSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
      required: ['a', 'b'],
    }

    expect(checkParamsSchema(schema, ['a'])).toBe(false)
  })

  it('correct', () => {
    const schema: ObjectSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['a', 'b'],
    }

    expect(checkParamsSchema(schema, ['a', 'b'])).toBe(true)
  })
})

it('toOpenAPISchema', () => {
  expect(toOpenAPISchema(true)).toEqual({})
  expect(toOpenAPISchema(false)).toEqual({ not: {} })
  expect(toOpenAPISchema({ type: 'string' })).toEqual({ type: 'string' })
})

describe('resolveOpenAPIJsonSchemaRef', () => {
  const doc = {
    components: {
      schemas: {
        'a': { type: 'string' },
        'b': { type: 'number' },
        'c/c': { type: 'object' },
      },
    },
  } as any

  it('works', () => {
    expect(resolveOpenAPIJsonSchemaRef(doc, { $ref: '#/components/schemas/a' })).toEqual({ type: 'string' })
    expect(resolveOpenAPIJsonSchemaRef(doc, { $ref: '#/components/schemas/b' })).toEqual({ type: 'number' })
    expect(resolveOpenAPIJsonSchemaRef(doc, { $ref: '#/components/schemas/c/c' })).toEqual({ type: 'object' })
  })

  it('do nothing if schema is not $ref', () => {
    expect(resolveOpenAPIJsonSchemaRef(doc, true)).toEqual(true)
    expect(resolveOpenAPIJsonSchemaRef(doc, false)).toEqual(false)
    expect(resolveOpenAPIJsonSchemaRef(doc, {})).toEqual({})
    expect(resolveOpenAPIJsonSchemaRef(doc, { type: 'object' })).toEqual({ type: 'object' })
  })

  it('it do nothing if have no components.schemas', () => {
    const doc = {} as OpenAPI.Document
    const doc2 = {
      components: {},
    } as OpenAPI.Document

    expect(resolveOpenAPIJsonSchemaRef(doc, { type: 'string' })).toEqual({ type: 'string' })
    expect(resolveOpenAPIJsonSchemaRef(doc, { $ref: '#/components/schemas/a' })).toEqual({ $ref: '#/components/schemas/a' })
    expect(resolveOpenAPIJsonSchemaRef(doc2, { $ref: '#/components/schemas/a' })).toEqual({ $ref: '#/components/schemas/a' })
  })

  it('not resolve if $ref is not a components.schemas', () => {
    expect(resolveOpenAPIJsonSchemaRef(doc, { $ref: '#/$defs/a' })).toEqual({ $ref: '#/$defs/a' })
  })

  it('not resolve if $ref not found', () => {
    expect(resolveOpenAPIJsonSchemaRef(doc, { $ref: '#/components/schemas/not-found' })).toEqual({ $ref: '#/components/schemas/not-found' })
  })
})

describe('simplifyComposedObjectJsonSchemasAndRefs', () => {
  it('does not simplify non-object or non-composed schemas', () => {
    expect(simplifyComposedObjectJsonSchemasAndRefs(true)).toEqual(true)
    expect(simplifyComposedObjectJsonSchemasAndRefs({ type: 'string' })).toEqual({ type: 'string' })
    expect(simplifyComposedObjectJsonSchemasAndRefs({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    expect(simplifyComposedObjectJsonSchemasAndRefs({ allOf: [{ type: 'array' }] })).toEqual({ allOf: [{ type: 'array' }] })

    expect(simplifyComposedObjectJsonSchemasAndRefs({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'number' },
      ],
    })).toEqual({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'number' },
      ],
    })

    expect(simplifyComposedObjectJsonSchemasAndRefs({
      description: 'description',
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })).toEqual({
      description: 'description',
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })
  })

  it('only remain type, properties, required logics', () => {
    expect(simplifyComposedObjectJsonSchemasAndRefs({
      anyOf: [
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          description: 'description a',
        },
        {
          type: 'object',
          properties: { b: { type: 'number' } },
          required: ['b'],
          additionalProperties: false,
        },
      ],
      description: 'object description',
      additionalProperties: true,
    })).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
      required: [],
    })
  })

  describe.each(['anyOf', 'oneOf'])('%s', (keyword) => {
    it('ignore additional object logic', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        description: 'animal',
        [keyword]: [
          {
            type: 'object',
            properties: { type: { const: 'pig' }, weight: { type: 'number' } },
            required: ['type', 'weight'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { type: { const: 'dog' }, barkVolume: { type: 'number' } },
            required: ['type', 'barkVolume'],
            patternProperties: {
              '^S_': { type: 'string' },
              '^I_': { type: 'integer' },
            },
          },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          type: { anyOf: [{ const: 'pig' }, { const: 'dog' }] },
          weight: { type: 'number' },
          barkVolume: { type: 'number' },
        },
        required: ['type'],
      })
    })

    it('handles empty', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        description: 'empty',
        [keyword]: [],
      })).toEqual({
        description: 'empty',
        [keyword]: [],
      })
    })

    it('does not merge mixed object and non-object schemas', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        [keyword]: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'boolean' },
        ],
      })).toEqual({
        [keyword]: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'boolean' },
        ],
      })
    })

    it('merges object schemas with discriminated union', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        description: 'animal',
        [keyword]: [
          {
            type: 'object',
            properties: { type: { const: 'pig' }, weight: { type: 'number' } },
            required: ['type', 'weight'],
          },
          {
            type: 'object',
            properties: { type: { const: 'dog' }, barkVolume: { type: 'number' } },
            required: ['type', 'barkVolume'],
          },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          type: { anyOf: [{ const: 'pig' }, { const: 'dog' }] },
          weight: { type: 'number' },
          barkVolume: { type: 'number' },
        },
        required: ['type'],
      })
    })

    it('handle required & dedupe schemas correctly', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        [keyword]: [
          { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { a: { type: 'string' }, c: { type: 'string' } }, required: ['a', 'c'] },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          c: { type: 'string' },
        },
        required: ['a'],
      })
    })

    it('handles nested union recursively', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        [keyword]: [
          { [keyword]: [{ type: 'string' }, { type: 'number' }] },
          { type: 'boolean' },
        ],
      })).toEqual({
        [keyword]: [
          { [keyword]: [{ type: 'string' }, { type: 'number' }] },
          { type: 'boolean' },
        ],
      })
    })
  })

  describe('allOf', () => {
    it('handles empty', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        description: 'empty',
        allOf: [],
      })).toEqual({
        description: 'empty',
        allOf: [],
      })
    })

    it('merges object schemas', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
        required: ['a', 'b'],
      })
    })

    it('merges overlapping properties with allOf', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        allOf: [
          { type: 'object', properties: { a: { type: 'string', minLength: 1 } }, required: ['a'] },
          { type: 'object', properties: { a: { type: 'string', maxLength: 10 } }, required: ['a'] },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { allOf: [{ type: 'string', minLength: 1 }, { type: 'string', maxLength: 10 }] },
        },
        required: ['a'],
      })
    })

    it('handle required correctly & dedupe schemas', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { a: { type: 'string' }, c: { type: 'string' } }, required: ['a', 'c'] },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          c: { type: 'string' },
        },
        required: ['a', 'c'],
      })
    })

    it('handle nested compositions', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        allOf: [
          {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { type: 'object', properties: { b: { type: 'number' } } },
            ],
          },
          { type: 'object', properties: { c: { type: 'boolean' } }, required: ['c'] },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
          c: { type: 'boolean' },
        },
        required: ['a', 'c'],
      })
    })
  })

  describe('combined compositions', () => {
    it('recursively simplifies oneOf with nested allOf', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        oneOf: [
          {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
            ],
          },
          {
            allOf: [
              { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
              { type: 'object', properties: { c: { type: 'boolean' } }, required: ['c'] },
            ],
          },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { anyOf: [{ type: 'string' }, { type: 'number' }] },
          b: { type: 'number' },
          c: { type: 'boolean' },
        },
        required: ['a'],
      })
    })

    it('recursively simplifies anyOf with nested allOf', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        anyOf: [
          {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
            ],
          },
          {
            allOf: [
              { type: 'object', properties: { c: { type: 'boolean' } }, required: ['c'] },
              { type: 'object', properties: { d: { type: 'string' } }, required: ['d'] },
            ],
          },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
          c: { type: 'boolean' },
          d: { type: 'string' },
        },
        required: [],
      })
    })

    it('handles deeply nested compositions', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        anyOf: [
          {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } } },
            ],
          },
        ],
      })).toEqual({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: [],
      })
    })

    it('can simplify composed schemas with many compositions', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        anyOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }],
        allOf: [{ type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
        required: ['a', 'b'],
      })
    })

    it('dedupes schemas when anyOf and allOf coexist at the same level', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { a: { type: 'string' }, c: { type: 'string' } }, required: ['a', 'c'] },
        ],
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { a: { type: 'number' }, d: { type: 'string' } }, required: ['a', 'd'] },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: {
            allOf: [
              { type: 'string' },
              { anyOf: [{ type: 'string' }, { type: 'number' }] },
            ],
          },
          b: { type: 'string' },
          c: { type: 'string' },
          d: { type: 'string' },
        },
        required: ['a', 'c'],
      })
    })

    it('schema with object and composed schemas in the same level', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
        required: ['a'],
        anyOf: [
          {
            type: 'object',
            properties: {
              b: { type: 'number' },
              c: { type: 'boolean' },
            },
            required: ['b', 'c'],
          },
          {
            type: 'object',
            properties: {
              c: { type: 'boolean' },
            },
            required: ['c'],
          },
        ],
        allOf: [
          {
            type: 'object',
            properties: {
              f: { type: 'string' },
            },
            required: ['f'],
          },
        ],
      })).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { allOf: [{ type: 'string' }, { type: 'number' }] },
          c: { type: 'boolean' },
          f: { type: 'string' },
        },
        required: ['c', 'f', 'a'],
      })
    })
  })

  describe('with $ref', () => {
    const doc = {
      components: {
        schemas: {
          Base: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
          Extended: {
            allOf: [
              { $ref: '#/components/schemas/Base' },
              {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            ],
          },
        },
      },
    } as any

    it('resolves $ref before simplifying', () => {
      expect(simplifyComposedObjectJsonSchemasAndRefs(
        { $ref: '#/components/schemas/Extended' },
        doc,
      )).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      })

      expect(simplifyComposedObjectJsonSchemasAndRefs({
        allOf: [
          { $ref: '#/components/schemas/Base' },
          {
            type: 'object',
            properties: {
              age: { type: 'number' },
            },
            required: ['age'],
          },
        ],
      }, doc)).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['id', 'age'],
      })
    })
  })
})
