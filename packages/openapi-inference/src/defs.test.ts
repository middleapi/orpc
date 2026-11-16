import { releasedNames } from '../tests/fixtures/app/src/released-names'
import { OpenAPIGenerator } from './openapi-generator'

describe('def names', () => {
  it('keeps the name of a declared type that a released def was numbered with', async () => {
    const spec = await new OpenAPIGenerator().generate(releasedNames, {
      source: {
        file: new URL('../tests/fixtures/app/src/released-names.ts', import.meta.url),
        export: 'releasedNames',
      },
    })

    const ref = (name: string) => ({
      'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
    })
    // the second `User` shares the def of the first, and frees the name `User2` it held
    expect(spec.paths?.['/a']?.post?.responses?.['200']).toMatchObject({ content: ref('User') })
    expect(spec.paths?.['/b']?.post?.responses?.['200']).toMatchObject({ content: ref('User') })
    expect(spec.paths?.['/c']?.post?.responses?.['200']).toMatchObject({ content: ref('User2') })
    expect(Object.keys(spec.components?.schemas ?? {})).toEqual(['User', 'User2'])
  })
})
