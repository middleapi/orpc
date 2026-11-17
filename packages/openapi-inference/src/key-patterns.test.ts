import { toPattern } from './key-patterns'
import type { TypeScriptProject } from './project'
import { openTypeScriptProject } from './project'
import { TypeQueries } from './type-queries'

describe('toPattern', () => {
  let project: TypeScriptProject
  let types: TypeQueries

  const matcher = (name: string) =>
    new RegExp(`^(?:${toPattern(types, project.getExportType(name).type)})$`, 'u')

  beforeAll(() => {
    project = openTypeScriptProject({
      file: new URL('../tests/fixtures/schemas/src/key-patterns.ts', import.meta.url),
    })
    types = new TypeQueries(project.checker, project.program)
  })

  afterAll(() => {
    project.close()
  })

  it('fixture has no type errors', () => {
    expect(project.program.getSemanticDiagnostics(project.sourceFile.fileName)).toEqual([])
  })

  it('matches the integer literals a `bigint` template accepts', () => {
    const pattern = matcher('BigIntTemplate')

    for (const valid of ['id-1', 'id--12', 'id-0x1F', 'id-0o17', 'id-0b101']) {
      expect(pattern.test(valid)).toBe(true)
    }
    for (const invalid of ['id-', 'id-1.5', 'id- 1', 'id-+1', 'id-1n']) {
      expect(pattern.test(invalid)).toBe(false)
    }
  })

  it('matches branded literals as the literals, and branded primitives as the primitives', () => {
    expect(toPattern(types, project.getExportType('BrandedLiteralTemplate').type)).toBe('v-1')

    const primitives = matcher('BrandedPrimitiveTemplate')
    expect(primitives.test('1.5:any text')).toBe(true)
    expect(primitives.test('abc:any text')).toBe(false)
  })

  it('matches any string in place of a type parameter', () => {
    expect(toPattern(types, project.getExportType('GenericTemplate').type)).toBe('x-[\\s\\S]*')
  })
})
