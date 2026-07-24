import { oc } from '@orpc/contract'
import z from 'zod'
import { openapi, OpenAPIGenerator } from '../../src'
import { zodJsonSchemaConverter } from '../__shared__/schema'

describe('openAPIGenerator e2e: reusable component schemas', () => {
  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

  it('hoists a recursive entity into a single component referenced everywhere', async () => {
    const Category: z.ZodTypeAny = z.lazy(() => z.object({
      name: z.string(),
      children: z.array(Category).optional(),
    })).meta({ id: 'Category' })

    const doc = await generator.generate({
      getCategory: oc
        .meta(openapi({ method: 'GET', path: '/categories/{name}' }))
        .input(z.object({ name: z.string() }))
        .output(z.object({ category: Category })),
      createCategory: oc
        .meta(openapi({ method: 'POST', path: '/categories' }))
        .input(z.object({ category: Category }))
        .output(z.object({ category: Category })),
    })

    expect((doc.paths?.['/categories/{name}']?.get?.responses?.[200] as any).content['application/json'].schema).toEqual(
      expect.objectContaining({
        properties: {
          category: { $ref: '#/components/schemas/Category' },
        },
      }),
    )
    expect((doc.paths?.['/categories']?.post?.requestBody as any).content['application/json'].schema).toEqual(
      expect.objectContaining({
        properties: {
          category: { $ref: '#/components/schemas/Category' },
        },
      }),
    )

    expect(doc.components?.schemas).toEqual({
      Category: expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/Category' },
          },
        }),
      }),
    })
  })

  it('hoists mutually recursive entities that reference each other', async () => {
    const User: z._ZodType = z.object({
      name: z.string(),
      // eslint-disable-next-line ts/no-use-before-define
      posts: z.array(z.lazy(() => Post)).optional(),
    }).meta({ id: 'User' })

    const Post: z.ZodTypeAny = z.object({
      title: z.string(),
      author: z.lazy(() => User).optional(),
    }).meta({ id: 'Post' })

    const doc = await generator.generate({
      getUser: oc.input(z.object({ user: User })).output(z.object({ user: User })),
      getPost: oc.input(z.object({ post: Post })).output(z.object({ post: Post })),
    })

    expect(doc.components?.schemas).toEqual({
      User: expect.objectContaining({
        properties: expect.objectContaining({
          posts: {
            type: 'array',
            items: { $ref: '#/components/schemas/Post' },
          },
        }),
      }),
      Post: expect.objectContaining({
        properties: expect.objectContaining({
          author: { $ref: '#/components/schemas/User' },
        }),
      }),
    })
  })

  it('reuses equal base document components and postfixes conflicting ones', async () => {
    const Planet = z.object({ id: z.string() }).meta({ id: 'Planet' })
    const Moon = z.object({ radius: z.number() }).meta({ id: 'Moon' })

    const doc = await generator.generate({
      planet: oc.input(z.object({ planet: Planet, moon: Moon })),
    }, {
      base: {
        components: {
          schemas: {
            // equal to the generated Planet schema, reused as-is
            Planet: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            } as any,
            // different from the generated Moon schema, forcing a postfix
            Moon: { type: 'string' } as any,
          },
        },
      },
    })

    expect((doc.paths?.['/planet']?.post?.requestBody as any).content['application/json'].schema).toEqual(
      expect.objectContaining({
        properties: {
          planet: { $ref: '#/components/schemas/Planet' },
          moon: { $ref: '#/components/schemas/Moon2' },
        },
      }),
    )

    expect(doc.components?.schemas).toEqual({
      Planet: expect.objectContaining({ type: 'object' }),
      Moon: { type: 'string' },
      Moon2: expect.objectContaining({
        properties: expect.objectContaining({
          radius: { type: 'number' },
        }),
      }),
    })
  })

  it('keeps schemas inline when shouldHoistDef declines them', async () => {
    const Planet = z.object({ id: z.string() }).meta({ id: 'Planet' })

    const doc = await generator.generate({
      planet: oc.input(z.object({ planet: Planet })),
    }, {
      shouldHoistDef: () => false,
    })

    expect(doc.components).toBeUndefined()
    expect((doc.paths?.['/planet']?.post?.requestBody as any).content['application/json'].schema).toEqual(
      expect.objectContaining({
        $defs: expect.objectContaining({
          Planet: expect.any(Object),
        }),
      }),
    )
  })

  it('references components from detailed request and response bodies', async () => {
    const doc = await generator.generate({
      updatePlanet: oc
        .meta(openapi({ path: '/planets/{id}', inputStructure: 'detailed', outputStructure: 'detailed' }))
        .input(z.object({
          params: z.object({ id: z.string() }),
          body: z.object({ name: z.string() }).meta({ id: 'UpdatePlanetInput' }),
        }))
        .output(z.object({
          body: z.object({ updated: z.boolean() }).meta({ id: 'UpdatePlanetOutput' }),
        })),
    })

    expect(doc.paths?.['/planets/{id}']?.post).toEqual(expect.objectContaining({
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdatePlanetInput' },
          },
        },
      },
      responses: {
        200: expect.objectContaining({
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdatePlanetOutput' },
            },
          },
        }),
      },
    }))
  })
})
