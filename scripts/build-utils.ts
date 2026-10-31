import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

/**
 * Whether a file (relative to the transform `input`) is test-only and must not be published.
 * Mirrors the test `exclude` of each package's tsconfig.json.
 */
export function isTestFile(file: string): boolean {
  return /\.(?:test|test-d|bench)\.|__(?:tests|mocks|snapshots)__\//.test(file)
}

interface PackageJson {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  sideEffects?: boolean | string[]
  publishConfig?: { exports?: Record<string, string | Record<string, string>> }
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
 *
 * `externals` lists bare specifiers provided by the runtime rather than by `node_modules`, e.g. `bun`.
 */
export function verifyDist(ctx: { pkgDir: string, pkg: unknown }, externals: string[] = []): void {
  const pkg = ctx.pkg as PackageJson
  const allowed = new Set([pkg.name, ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }), ...externals])
  const errors: string[] = []

  const files = new Set(
    readdirSync(path.join(ctx.pkgDir, 'dist'), { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.mjs') || file.endsWith('.d.mts'))
      .map(file => path.join('dist', file)),
  )
  const runtimeImports = new Map<string, string[]>()

  for (const file of files) {
    if (file.endsWith('.mjs') && !files.has(file.replace(/\.mjs$/, '.d.mts'))) {
      errors.push(`${file} has no declaration file, it probably fails \`isolatedDeclarations\``)
    }

    const relativeImports: string[] = []

    for (const specifier of collectSpecifiers(file, readFileSync(path.join(ctx.pkgDir, file), 'utf8'))) {
      if (specifier.startsWith('.')) {
        // declarations import `./x.mjs`, which TypeScript resolves to `./x.d.mts`
        const target = path.join(path.dirname(file), file.endsWith('.d.mts') ? specifier.replace(/\.mjs$/, '.d.mts') : specifier)

        if (!files.has(target) && target !== 'package.json') {
          errors.push(`${file} imports "${specifier}" which is not an emitted file`)
        }

        relativeImports.push(target)
      }
      else if (!isBuiltin(specifier)) {
        const packageName = specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

        if (!allowed.has(packageName)) {
          errors.push(`${file} imports "${specifier}" but "${packageName}" is not in dependencies or peerDependencies`)
        }
      }
    }

    if (file.endsWith('.mjs')) {
      runtimeImports.set(file, relativeImports)
    }
  }

  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (file: string): void => {
    if (stack.includes(file)) {
      errors.push(`import cycle ${[...stack.slice(stack.indexOf(file)), file].join(' -> ')}, move shared values into a leaf module`)
      return
    }

    if (!visited.has(file)) {
      visited.add(file)
      stack.push(file)
      runtimeImports.get(file)?.forEach(visit)
      stack.pop()
    }
  }
  runtimeImports.forEach((_, file) => visit(file))

  const exportTargets = Object.values(pkg.publishConfig?.exports ?? {}).flatMap(target => typeof target === 'string' ? target : Object.values(target))

  for (const target of [...exportTargets, ...Array.isArray(pkg.sideEffects) ? pkg.sideEffects : []]) {
    if (!existsSync(path.join(ctx.pkgDir, target))) {
      errors.push(`${target} is referenced in package.json but was not emitted`)
    }
  }

  if (errors.length) {
    throw new Error(`[verify-dist] ${pkg.name}:\n${errors.map(error => `  - ${error}`).join('\n')}`)
  }
}

/**
 * Specifiers of imports/exports, `import('x')` calls and types, `declare module 'x'` and `/// <reference types="x" />`.
 * (`ts.preProcessFile` would be shorter but misses `export * as ns from 'x'`.)
 */
function collectSpecifiers(fileName: string, code: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest)
  const specifiers = sourceFile.typeReferenceDirectives.map(reference => reference.fileName)

  const visit = (node: ts.Node): void => {
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
        ? node.argument.literal
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : ts.isModuleDeclaration(node) ? node.name : undefined

    if (specifier && ts.isStringLiteralLike(specifier)) {
      specifiers.push(specifier.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return specifiers
}
