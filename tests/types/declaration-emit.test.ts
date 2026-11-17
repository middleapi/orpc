import path from 'node:path'

import ts from 'typescript-6'

/**
 * Recursive client types delegate to exported `*Internal` helpers. A consumer whose
 * declaration emit has to print one of these types (e.g. the inferred return type of a
 * generic wrapper) must get a nameable reference, not an inlined type truncated to
 * `any` — which is what happens when the helper is not exported.
 */

const ROOT_DIR = path.resolve(import.meta.dirname, '../..')
const CONSUMER_FILE = path.join(ROOT_DIR, 'tests/types/__declaration-emit-consumer__.ts')

const ALIASES = [
  ['client', 'InferClientInputs'],
  ['client', 'InferClientBodyInputs'],
  ['client', 'InferClientOutputs'],
  ['client', 'InferClientBodyOutputs'],
  ['client', 'InferClientErrors'],
  ['client', 'InferClientError'],
  ['client', 'SafeClient'],
  ['client', 'ORPCClientScoped'],
  ['effect', 'EffectClient'],
  ['openapi', 'JsonifiedClient'],
  ['tanstack-query', 'RouterUtils'],
  ['tanstack-query', 'RouterUtilsScoped'],
  ['swr', 'RouterUtils'],
  ['pinia-colada', 'RouterUtils'],
  ['pinia-colada', 'RouterUtilsScoped'],
] as const

function createConsumerSource(): string {
  // Types are referenced through `import()` only, like a consumer that never imports them
  // by name, so declaration emit has to find an exported name to reference on its own.
  const wrappers = ALIASES.map(([pkg, alias]) => {
    const name = `${toIdentifier(pkg)}_${alias}`

    return [
      `declare function ${name}<T extends AnyNestedClient>(client: T): import('../../packages/${pkg}/src').${alias}<T>`,
      `export function wrap_${name}<T extends AnyNestedClient>(client: T) { return ${name}(client) }`,
    ].join('\n')
  })

  return [`import type { AnyNestedClient } from '../../packages/client/src'`, ...wrappers].join(
    '\n',
  )
}

function toIdentifier(pkg: string): string {
  return pkg.replace(/-/g, '_')
}

function emitConsumerDeclaration(): { dts: string; diagnostics: string[] } {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    types: ['node'],
    declaration: true,
    emitDeclarationOnly: true,
    skipLibCheck: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
  }

  const source = createConsumerSource()
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)

  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    path.resolve(fileName) === CONSUMER_FILE
      ? ts.createSourceFile(fileName, source, languageVersion)
      : getSourceFile(fileName, languageVersion, ...rest)

  const fileExists = host.fileExists.bind(host)
  host.fileExists = (fileName) => path.resolve(fileName) === CONSUMER_FILE || fileExists(fileName)

  let dts = ''
  host.writeFile = (fileName, text) => {
    if (
      fileName.endsWith('.d.ts') &&
      path.resolve(fileName).startsWith(CONSUMER_FILE.slice(0, -3))
    ) {
      dts = text
    }
  }

  const program = ts.createProgram([CONSUMER_FILE], options, host)
  const result = program.emit(program.getSourceFile(CONSUMER_FILE))

  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program, program.getSourceFile(CONSUMER_FILE)),
    ...result.diagnostics,
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

  return { dts, diagnostics }
}

describe('declaration emit of recursive client types', () => {
  const { dts, diagnostics } = emitConsumerDeclaration()

  it('emits without diagnostics', () => {
    expect(diagnostics).toEqual([])
    expect(dts).not.toBe('')
  })

  it('never inlines a truncated type', () => {
    expect(dts).not.toContain('elided')
  })

  it.each(ALIASES)('names %s %s in a generic return type', (pkg, alias) => {
    const name = `wrap_${toIdentifier(pkg)}_${alias}`
    const line = dts.split('\n').find((line) => line.includes(`function ${name}<`))

    expect(line).toMatch(
      new RegExp(`\\): import\\("[^"]+/packages/${pkg}/src"\\)\\.${alias}Internal<T>;$`),
    )
  })
})
