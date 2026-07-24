import { oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator component schemas', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  describe('hoisting', () => {
    it('hoists $defs components, rewrites wrapper refs, and collapses local aliases', async () => {
      const Category: z.ZodTypeAny = z.lazy(() => z.looseObject({
        name: z.string(),
        children: z.array(Category).optional(),
      })).meta({ id: 'Category' })

      const doc = await generator.generate({
        category: oc
          .input(z.object({ category: Category }))
          .output(z.object({ category2: Category })),
      })

      expect(doc.paths?.['/category']?.post).toEqual(expect.objectContaining({
        operationId: 'category',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  category: { $ref: '#/components/schemas/Category' },
                },
              }),
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    category2: { $ref: '#/components/schemas/Category' },
                  },
                }),
              },
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Category: {
          type: 'object',
          additionalProperties: {},
          properties: {
            children: {
              items: {
                $ref: '#/components/schemas/Category',
              },
              type: 'array',
            },
            name: {
              type: 'string',
            },
          },
          required: [
            'name',
          ],
        },
      })
    })

    it('uses shouldHoistDef to select defs and related', async () => {
      const planetSchema = testSchema({
        type: 'object',
        properties: {
          planet: { $ref: '#/$defs/_PlanetAlias' },
        },
        required: ['planet'],
        $defs: {
          Planet: {
            type: 'object',
            properties: {
              id: { $ref: '#/$defs/_PlanetId' },
            },
            required: ['id'],
          },
          _PlanetId: { type: 'string' },
          _PlanetAlias: {
            $ref: '#/$defs/Planet',
          },
        },
      })

      const shouldHoistDef = vi.fn((defName: string, _schema) => {
        return defName !== '_PlanetAlias'
      })

      const doc = await generator.generate({
        planet: oc
          .input(planetSchema)
          .output(planetSchema),
      }, {
        shouldHoistDef,
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  planet: { $ref: '#/$defs/_PlanetAlias' },
                },
                required: ['planet'],
                $defs: {
                  _PlanetAlias: {
                    $ref: '#/components/schemas/Planet',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    planet: { $ref: '#/$defs/_PlanetAlias' },
                  },
                  required: ['planet'],
                  $defs: {
                    _PlanetAlias: {
                      $ref: '#/components/schemas/Planet',
                    },
                  },
                },
              },
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Planet: {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/_PlanetId' },
          },
          required: ['id'],
        },
        _PlanetId: { type: 'string' },
      })

      expect(shouldHoistDef).toHaveBeenCalledWith('Planet', {
        type: 'object',
        properties: {
          id: { $ref: '#/$defs/_PlanetId' },
        },
        required: ['id'],
      })
      expect(shouldHoistDef).toHaveBeenCalledWith('_PlanetId', {
        type: 'string',
      })
      expect(shouldHoistDef).toHaveBeenCalledWith('_PlanetAlias', {
        $ref: '#/$defs/Planet',
      })
    })

    it('hoists $defs from each allOf branch when multiple zod inputs and outputs are combined', async () => {
      const inputSharedLeft = z.object({ source: z.literal('input-left') }).meta({ id: 'InputLeft' })
      const inputSharedRight = z.object({ source: z.literal('input-right') }).meta({ id: 'Right' })
      const outputSharedLeft = z.object({ source: z.literal('output-left') }).meta({ id: 'OutputLeft' })
      const outputSharedRight = z.object({ source: z.literal('output-right') }).meta({ id: 'Right' })

      const doc = await generator.generate({
        planet: oc
          .input(z.looseObject({ left: inputSharedLeft }))
          .input(z.looseObject({ right: inputSharedRight }))
          .output(z.looseObject({ left: outputSharedLeft }))
          .output(z.looseObject({ right: outputSharedRight })),
      }, {
        shouldHoistDef: name => name !== 'InputLeft',
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $defs: {
                  InputLeft: expect.objectContaining({
                    type: 'object',
                    properties: {
                      source: { const: 'input-left', type: 'string' },
                    },
                    required: ['source'],
                  }),
                },
                allOf: [
                  expect.objectContaining({
                    type: 'object',
                    properties: {
                      left: { $ref: '#/$defs/InputLeft' },
                    },
                    required: ['left'],
                  }),
                  expect.objectContaining({
                    type: 'object',
                    properties: {
                      right: { $ref: '#/components/schemas/Right' },
                    },
                    required: ['right'],
                  }),
                ],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    expect.objectContaining({
                      type: 'object',
                      properties: {
                        left: { $ref: '#/components/schemas/OutputLeft' },
                      },
                      required: ['left'],
                    }),
                    expect.objectContaining({
                      type: 'object',
                      properties: {
                        right: { $ref: '#/components/schemas/Right2' },
                      },
                      required: ['right'],
                    }),
                  ],
                },
              },
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual(expect.objectContaining({
        Right: expect.objectContaining({
          type: 'object',
          properties: {
            source: { const: 'input-right', type: 'string' },
          },
          required: ['source'],
        }),
        OutputLeft: expect.objectContaining({
          type: 'object',
          properties: {
            source: { const: 'output-left', type: 'string' },
          },
          required: ['source'],
        }),
        Right2: expect.objectContaining({
          type: 'object',
          properties: {
            source: { const: 'output-right', type: 'string' },
          },
          required: ['source'],
        }),
      }))
    })

    it('keeps direct recursive roots inline when they are not inside $defs', async () => {
      const Planet: z.ZodTypeAny = z.lazy(() => z.object({
        id: z.string(),
        children: z.array(Planet).optional(),
      })).meta({ id: 'Planet' })

      const doc = await generator.generate({
        planet: oc.input(Planet),
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  children: {
                    type: 'array',
                    items: { $ref: '#' },
                  },
                },
                required: ['id'],
              },
            },
          },
        },
      }))

      expect(doc.components?.schemas).toBeUndefined()
    })

    it('can maps params, query, headers, body as $ref in detailed mode', async () => {
      const doc = await generator.generate({
        planet: oc
          .meta(openapi({ path: '/{id}', inputStructure: 'detailed', outputStructure: 'detailed' }))
          .input(z.object({
            params: z.object({ id: z.string() }).meta({ id: 'InputParams' }),
            query: z.object({ filter: z.string() }).meta({ id: 'InputQuery' }),
            headers: z.object({ 'x-token-1': z.string() }).meta({ id: 'InputHeaders' }),
            body: z.object({ name1: z.string() }).meta({ id: 'InputBody' }),
          }))
          .output(z.object({
            headers: z.object({ 'x-token-2': z.string() }).meta({ id: 'OutputHeaders' }),
            body: z.object({ name2: z.string() }).meta({ id: 'OutputBody' }),
          })),
      })

      expect(doc.paths?.['/{id}']?.post).toEqual(expect.objectContaining({
        parameters: expect.arrayContaining([
          expect.objectContaining({
            name: 'id',
            in: 'path',
          }),
          expect.objectContaining({
            name: 'filter',
            in: 'query',
          }),
          expect.objectContaining({
            name: 'x-token-1',
            in: 'header',
          }),
        ]),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InputBody' },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OutputBody' },
              },
            },
            headers: {
              'x-token-2': expect.objectContaining({}),
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual(expect.objectContaining({
        InputBody: expect.objectContaining({
          type: 'object',
          properties: {
            name1: { type: 'string' },
          },
        }),
        OutputBody: expect.objectContaining({
          type: 'object',
          properties: {
            name2: { type: 'string' },
          },
        }),
      }))
    })
  })

  describe('name reuse', () => {
    it('reuses the same component name when input and output json schemas are equal', async () => {
      const doc = await generator.generate({
        planet: oc
          .input(z.object({ left: z.looseObject({ id: z.string() }).meta({ id: 'Planet' }) }))
          .output(z.object({ right: z.looseObject({ id: z.string() }).meta({ id: 'Planet' }) })),
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  left: { $ref: '#/components/schemas/Planet' },
                },
              }),
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    right: { $ref: '#/components/schemas/Planet' },
                  },
                }),
              },
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Planet: expect.objectContaining({
          type: 'object',
        }),
      })
    })

    it('reuses an equal base component without adding a postfix', async () => {
      const Planet = z.object({ id: z.string() }).meta({ id: 'Planet' })

      const doc = await generator.generate({
        planet: oc.input(z.object({ planet: Planet })),
      }, {
        base: {
          components: {
            schemas: {
              Planet: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                },
                required: ['id'],
              } as any,
            },
          },
        },
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  planet: { $ref: '#/components/schemas/Planet' },
                },
              }),
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Planet: expect.objectContaining({
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        }),
      })
    })

    it('can reuses schemas reference each others recursively', async () => {
      const Schema1: z._ZodType = z.object({
        // eslint-disable-next-line ts/no-use-before-define
        schema2: z.lazy(() => Schema2).optional(),
      }).meta({ id: 'Schema1' })

      const Schema2: z.ZodTypeAny = z.object({
        schema1: z.lazy(() => Schema1).optional(),
      }).meta({ id: 'Schema2' })

      const doc = await generator.generate({
        planet1: oc
          .input(z.object({ Schema1 }))
          .output(z.object({ Schema1 })),
        planet2: oc
          .input(z.object({ Schema2 }))
          .output(z.object({ Schema2 })),
      })

      expect(doc.paths?.['/planet1']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  Schema1: { $ref: '#/components/schemas/Schema1' },
                },
              }),
            },
          },
        },
      }))

      expect(doc.paths?.['/planet2']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  Schema2: { $ref: '#/components/schemas/Schema2' },
                },
              }),
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Schema1: expect.objectContaining({
          type: 'object',
          properties: {
            schema2: { $ref: '#/components/schemas/Schema2' },
          },
        }),
        Schema2: expect.objectContaining({
          type: 'object',
          properties: {
            schema1: { $ref: '#/components/schemas/Schema1' },
          },
        }),
      })
    })
  })

  describe('name conflicts', () => {
    it('adds a numbered postfix when equal refs map to different schema', async () => {
      const PlanetInput = z.object({ id: z.string() }).meta({ id: 'Planet', description: 'PlanetInput' })
      const PlanetOutput = z.object({ id: z.number() }).meta({ id: 'Planet', description: 'PlanetOutput' })

      const doc = await generator.generate({
        planet: oc
          .input(z.object({ left: PlanetInput, right: PlanetInput }))
          .output(z.object({ left: PlanetOutput, right: PlanetOutput })),
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  left: { $ref: '#/components/schemas/Planet' },
                  right: { $ref: '#/components/schemas/Planet' },
                },
              }),
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    left: { $ref: '#/components/schemas/Planet2' },
                    right: { $ref: '#/components/schemas/Planet2' },
                  },
                }),
              },
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Planet: expect.objectContaining({
          description: 'PlanetInput',
        }),
        Planet2: expect.objectContaining({
          description: 'PlanetOutput',
        }),
      })
    })

    it('adds a postfix when an existing base component has a different json schema', async () => {
      const Planet: z.ZodTypeAny = z.lazy(() => z.object({
        id: z.string(),
        children: z.array(Planet).optional(),
      })).meta({ id: 'Planet' })

      const doc = await generator.generate({
        planet: oc.input(z.object({ Planet })),
      }, {
        base: {
          components: {
            schemas: {
              Planet: {
                type: 'object',
                properties: {
                  legacy: { type: 'boolean' },
                },
              },
            },
          },
        },
      })

      expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  Planet: { $ref: '#/components/schemas/Planet2' },
                },
              }),
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Planet: expect.objectContaining({
          type: 'object',
          properties: {
            legacy: { type: 'boolean' },
          },
        }),
        Planet2: expect.objectContaining({
          properties: expect.objectContaining({
            id: { type: 'string' },
          }),
        }),
      })
    })

    it('adds numbered postfixes for recursive reference schemas when base component names conflict', async () => {
      const Schema1: z._ZodType = z.object({
        // eslint-disable-next-line ts/no-use-before-define
        schema2: z.lazy(() => Schema2).optional(),
      }).meta({ id: 'Schema1' })

      const Schema2: z.ZodTypeAny = z.object({
        schema1: z.lazy(() => Schema1).optional(),
      }).meta({ id: 'Schema2' })

      const doc = await generator.generate({
        planet1: oc
          .input(z.object({ Schema1 }))
          .output(z.object({ Schema1 })),
        planet2: oc
          .input(z.object({ Schema2 }))
          .output(z.object({ Schema2 })),
      }, {
        base: {
          components: {
            schemas: {
              Schema1: { type: 'string' },
            },
          },
        },
      })

      expect(doc.paths?.['/planet1']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  Schema1: { $ref: '#/components/schemas/Schema12' },
                },
              }),
            },
          },
        },
      }))

      expect(doc.paths?.['/planet2']?.post).toEqual(expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  Schema2: { $ref: '#/components/schemas/Schema2' },
                },
              }),
            },
          },
        },
      }))

      expect(doc.components?.schemas).toEqual({
        Schema1: expect.objectContaining({ type: 'string' }),
        Schema12: expect.objectContaining({
          type: 'object',
          properties: {
            schema2: { $ref: '#/components/schemas/Schema2' },
          },
        }),
        Schema2: expect.objectContaining({
          type: 'object',
          properties: {
            schema1: { $ref: '#/components/schemas/Schema12' },
          },
        }),
      })
    })
  })
})
