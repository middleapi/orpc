import { oc } from '@orpc/contract'
import z from 'zod'
import { OpenRPCGenerator } from '../../src'
import { zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: reusable component schemas', () => {
  const generator = new OpenRPCGenerator({ converters: [zodJsonSchemaConverter] })

  it('hoists a recursive entity into a single component referenced from params and results', async () => {
    const Category: z.ZodTypeAny = z.lazy(() => z.looseObject({
      name: z.string(),
      children: z.array(Category).optional(),
    })).meta({ id: 'Category' })

    const doc = await generator.generate({
      getCategory: oc.input(z.object({ name: z.string() })).output(Category),
      createCategory: oc.input(z.object({ category: Category })).output(z.object({ category: Category })),
    })

    expect(doc.methods).toEqual([
      expect.objectContaining({
        name: 'getCategory',
        result: { name: 'result', schema: { $ref: '#/components/schemas/Category' } },
      }),
      expect.objectContaining({
        name: 'createCategory',
        params: [{ name: 'category', required: true, schema: { $ref: '#/components/schemas/Category' } }],
        result: { name: 'result', schema: expect.objectContaining({ properties: { category: { $ref: '#/components/schemas/Category' } } }) },
      }),
    ])
    expect(doc.components).toEqual({
      schemas: {
        Category: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
          },
          required: ['name'],
          additionalProperties: {},
        },
      },
    })
  })

  it('hoists mutually recursive entities, and splits one used as the whole input into by-name params', async () => {
    const User: z._ZodType = z.looseObject({
      name: z.string(),
      // eslint-disable-next-line ts/no-use-before-define
      posts: z.array(z.lazy(() => Post)).optional(),
    }).meta({ id: 'User' })

    const Post: z.ZodTypeAny = z.looseObject({
      title: z.string(),
      author: z.lazy(() => User).optional(),
    }).meta({ id: 'Post' })

    const doc = await generator.generate({
      getUser: oc.input(z.object({ user: User })).output(z.object({ user: User })),
      updatePost: oc.input(Post).output(Post),
    })

    expect(doc.methods[1]).toEqual({
      name: 'updatePost',
      paramStructure: 'by-name',
      params: [
        { name: 'title', required: true, schema: { type: 'string' } },
        { name: 'author', schema: { $ref: '#/components/schemas/User' } },
      ],
      result: { name: 'result', schema: { $ref: '#/components/schemas/Post' } },
    })
    expect(doc.components?.schemas).toEqual({
      User: expect.objectContaining({
        properties: expect.objectContaining({ posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } } }),
      }),
      Post: expect.objectContaining({
        properties: expect.objectContaining({ author: { $ref: '#/components/schemas/User' } }),
      }),
    })
  })

  it('hoists an entity that recurses to its own root out of params and results', async () => {
    const Tree: z.ZodTypeAny = z.looseObject({
      name: z.string(),
      get children() { return z.array(Tree) },
    })

    const doc = await generator.generate({
      createTree: oc.input(Tree).output(Tree.optional()),
    })

    expect(doc.methods).toEqual([{
      name: 'createTree',
      paramStructure: 'by-name',
      params: [
        { name: 'name', required: true, schema: { type: 'string' } },
        { name: 'children', required: true, schema: { type: 'array', items: { $ref: '#/components/schemas/__schema0' } } },
      ],
      result: { name: 'result', schema: { anyOf: [{ $ref: '#/components/schemas/__schema0' }, { type: 'null' }] } },
    }])
    expect(doc.components?.schemas).toEqual({
      __schema0: expect.objectContaining({
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/__schema0' } },
        },
      }),
    })
  })
})
