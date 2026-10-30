import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

/**
 * Shared helpers for the `build.config.ts` (obuild) of every package.
 */

const TEST_FILE_REGEX = /\.(?:test|test-d|bench)\.[cm]?[jt]sx?$|(?:^|\/)__(?:tests|mocks|snapshots)__\//

/**
 * Whether a file (relative to the transform `input`) is a test-only file
 * that must not be published.
 */
export function isTestFile(file: string): boolean {
  return TEST_FILE_REGEX.test(file)
}

export interface VerifyDistOptions {
  /**
   * Bare specifiers provided by the runtime rather than by `node_modules`,
   * e.g. `bun` or `cloudflare:workers`.
   */
  externals?: string[]
}

interface PackageJson {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  sideEffects?: boolean | string[]
  publishConfig?: { exports?: Record<string, unknown> }
}

/**
 * Runs after obuild, which does not check any of these, so `prepack` fails instead of publishing a broken package:
 *
 * - every bare import in `dist` (runtime and type-level) is declared in `dependencies` or `peerDependencies`
 * - every relative import in `dist` points to an emitted file (obuild does not rewrite dynamic imports,
 *   and imports leaving `src` would point to unpublished files)
 * - no runtime import cycle exists between `dist` files (bundling used to hide evaluation-order issues)
 * - every `.mjs` has a `.d.mts` (obuild only warns when a file fails `isolatedDeclarations`)
 * - every path in `publishConfig.exports` and `sideEffects` exists
 */
export function verifyDist({ pkgDir }: { pkgDir: string }, options: VerifyDistOptions = {}): void {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as PackageJson
  const allowed = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...options.externals ?? [],
  ])

  const errors: string[] = []
  const distDir = path.join(pkgDir, 'dist')
  const files = readdirSync(distDir, { recursive: true, encoding: 'utf8' })
    .map(file => path.join('dist', file))
    .filter(file => file.endsWith('.mjs') || file.endsWith('.d.mts'))
  const runtimeImports = new Map<string, string[]>()

  for (const file of files) {
    if (file.endsWith('.mjs') && !files.includes(file.replace(/\.mjs$/, '.d.mts'))) {
      errors.push(`${file} has no declaration file, it probably fails \`isolatedDeclarations\``)
    }

    const relativeImports: string[] = []

    for (const specifier of collectSpecifiers(file, readFileSync(path.join(pkgDir, file), 'utf8'))) {
      if (specifier.startsWith('.')) {
        // declarations import `./x.mjs`, which TypeScript resolves to `./x.d.mts`
        const target = path.join(path.dirname(file), file.endsWith('.d.mts') ? specifier.replace(/\.mjs$/, '.d.mts') : specifier)

        if (!(files.includes(target) || target === 'package.json')) {
          errors.push(`${file} imports "${specifier}" which is not an emitted file`)
        }

        relativeImports.push(target)
        continue
      }

      if (isBuiltin(specifier)) {
        continue
      }

      const packageName = specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

      if (!allowed.has(packageName)) {
        errors.push(`${file} imports "${specifier}" but "${packageName}" is not in dependencies or peerDependencies`)
      }
    }

    if (file.endsWith('.mjs')) {
      runtimeImports.set(file, relativeImports)
    }
  }

  for (const cycle of findCycles(runtimeImports)) {
    errors.push(`import cycle ${cycle.join(' -> ')}, evaluation order now depends on which file is imported first`)
  }

  const publishedPaths = [
    ...collectExportTargets(pkg.publishConfig?.exports),
    ...Array.isArray(pkg.sideEffects) ? pkg.sideEffects : [],
  ]

  for (const publishedPath of publishedPaths) {
    if (!existsSync(path.join(pkgDir, publishedPath))) {
      errors.push(`${publishedPath} is referenced in package.json but was not emitted`)
    }
  }

  if (errors.length) {
    throw new Error(`[verify-dist] ${pkg.name}:\n${errors.map(error => `  - ${error}`).join('\n')}`)
  }
}

/**
 * Module specifiers of static/dynamic imports and exports, `import('x')` types,
 * `declare module 'x'` augmentations and `/// <reference types="x" />` directives.
 */
function collectSpecifiers(fileName: string, code: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest)
  const specifiers = sourceFile.typeReferenceDirectives.map(reference => reference.fileName)

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    }
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text)
    }
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      specifiers.push(node.name.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return specifiers
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = []
  const done = new Set<string>()
  const stack: string[] = []

  const visit = (file: string): void => {
    const index = stack.indexOf(file)

    if (index !== -1) {
      cycles.push([...stack.slice(index), file])
      return
    }

    if (done.has(file)) {
      return
    }

    stack.push(file)

    for (const dependency of graph.get(file) ?? []) {
      visit(dependency)
    }

    stack.pop()
    done.add(file)
  }

  for (const file of graph.keys()) {
    visit(file)
  }

  return cycles
}

function collectExportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(collectExportTargets)
  }

  return []
}
