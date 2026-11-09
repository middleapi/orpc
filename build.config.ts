import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { build } from 'obuild'
import type { BuildConfig } from 'obuild/config'
import { defineBuildConfig } from 'obuild/config'
import ts from 'typescript-6'

/**
 * The build of every package in `packages/*`: each `prepack` runs `node ../../build.config.ts`, which builds
 * the package in the current directory (obuild's CLI only reads a `build.config.ts` next to the package).
 *
 * obuild's transform mode emits one `.mjs` + `.d.mts` per source file with oxc. Declarations come from
 * `isolatedDeclarations`, so they only depend on the file itself, unlike tsc's, whose import elision
 * depends on the whole program (an import used only inside a `declare module` augmentation was dropped
 * when another file augmented the same name).
 */

interface PackageOptions {
  /**
   * Bare specifiers provided by the runtime rather than by `node_modules`, e.g. `bun`.
   */
  runtimeModules?: string[]
  /**
   * Extra oxc options, matching the package's tsconfig.
   */
  oxc?: NonNullable<
    Extract<NonNullable<BuildConfig['entries']>[number], { type: 'transform' }>['oxc']
  >
}

const PACKAGE_OPTIONS: Record<string, PackageOptions> = {
  '@orpc/bun': { runtimeModules: ['bun'] },
  '@orpc/cloudflare': { runtimeModules: ['cloudflare:workers'] },
  '@orpc/nest': { oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } } },
}

type BuildContext = Parameters<NonNullable<NonNullable<BuildConfig['hooks']>['end']>>[0]

interface PackageJson {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  sideEffects?: boolean | string[]
  publishConfig?: { exports?: Record<string, string | Record<string, string>> }
}

const config: BuildConfig = defineBuildConfig({
  entries: [
    {
      type: 'transform',
      input: './src',
      outDir: './dist',
      filter: (file) => !isTestFile(file),
    },
  ],
  hooks: {
    entries(entries, ctx) {
      const oxc = PACKAGE_OPTIONS[ctx.pkg.name]?.oxc

      for (const entry of entries) {
        if (entry.type === 'transform' && oxc) {
          entry.oxc = { ...entry.oxc, ...oxc }
        }
      }
    },
    end(ctx) {
      inlineJsonImports(ctx)
      verifyDist(ctx)
    },
  },
})

await build({ ...config, cwd: process.cwd() })

/**
 * Whether a file (relative to the transform `input`) is test-only and must not be published.
 * Mirrors the test `exclude` of `tsconfig.lib.json`.
 */
function isTestFile(file: string): boolean {
  return /\.(?:test|test-d|bench)\.|__(?:tests|mocks|snapshots)__\//.test(file)
}

function listDist(ctx: BuildContext): string[] {
  return readdirSync(path.join(ctx.pkgDir, 'dist'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.mjs') || file.endsWith('.d.mts'))
    .map((file) => path.join('dist', file))
}

/**
 * Replaces `import x from './file.json' with { type: 'json' }` in the emitted `.mjs` with the JSON itself,
 * so the published code needs no import attributes and does not read `package.json` at runtime.
 *
 * When the binding is only read as `x.prop`, just those properties are inlined (e.g. `name` and
 * `version` of `package.json`, not its dependencies or scripts).
 */
function inlineJsonImports(ctx: BuildContext): void {
  for (const file of listDist(ctx).filter((file) => file.endsWith('.mjs'))) {
    const absolutePath = path.join(ctx.pkgDir, file)
    const code = readFileSync(absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
    const edits: { start: number; end: number; text: string }[] = []

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.attributes?.elements.some(
          (attribute) =>
            attribute.name.text === 'type' &&
            ts.isStringLiteral(attribute.value) &&
            attribute.value.text === 'json',
        )
      ) {
        continue
      }

      const specifier = statement.moduleSpecifier.text
      const binding = statement.importClause

      if (!specifier.startsWith('.') || !binding?.name || binding.namedBindings) {
        throw new Error(
          `[inline-json] ${ctx.pkg.name}: ${file} imports "${specifier}", only default imports of relative JSON files can be inlined`,
        )
      }

      const json: unknown = JSON.parse(
        readFileSync(path.resolve(path.dirname(absolutePath), specifier), 'utf8'),
      )
      const value = pickReadProperties(sourceFile, statement, binding.name.text, json)

      edits.push({
        start: statement.getStart(sourceFile),
        end: statement.end,
        // oxlint-disable-next-line no-restricted-properties -- a parsed JSON value always stringifies
        text: `const ${binding.name.text} = ${JSON.stringify(value)};`,
      })
    }

    if (edits.length) {
      let updated = code

      for (const edit of edits.toReversed()) {
        updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end)
      }

      writeFileSync(absolutePath, updated, 'utf8')
    }
  }
}

function pickReadProperties(
  sourceFile: ts.SourceFile,
  importDeclaration: ts.Node,
  name: string,
  json: unknown,
): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return json
  }

  const properties = new Set<string>()
  let readsWholeValue = false

  const visit = (node: ts.Node): void => {
    if (node === importDeclaration) {
      return
    }

    if (ts.isIdentifier(node) && node.text === name) {
      if (
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node &&
        ts.isIdentifier(node.parent.name)
      ) {
        properties.add(node.parent.name.text)
      } else {
        readsWholeValue = true
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (readsWholeValue) {
    return json
  }

  return Object.fromEntries(Object.entries(json).filter(([key]) => properties.has(key)))
}

/**
 * Runs after obuild, which does not check any of these, so `prepack` fails instead of publishing a broken package:
 *
 * - every bare import in `dist` (runtime and type-level) is declared in `dependencies` or `peerDependencies`
 * - every relative import in `dist` points to an emitted file (obuild does not rewrite dynamic imports,
 *   and imports leaving `src` would point to unpublished files)
 * - no runtime import cycle exists between `dist` files
 * - every `.mjs` has a `.d.mts` (obuild only warns when a file fails `isolatedDeclarations`)
 * - every path in `publishConfig.exports` and `sideEffects` exists
 */
function verifyDist(ctx: BuildContext): void {
  const pkg = ctx.pkg as PackageJson
  const allowed = new Set([
    pkg.name,
    ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }),
    ...(PACKAGE_OPTIONS[pkg.name]?.runtimeModules ?? []),
  ])
  const errors: string[] = []

  const files = new Set(listDist(ctx))
  const runtimeImports = new Map<string, string[]>()

  for (const file of files) {
    if (file.endsWith('.mjs') && !files.has(file.replace(/\.mjs$/, '.d.mts'))) {
      errors.push(`${file} has no declaration file, it probably fails \`isolatedDeclarations\``)
    }

    const relativeImports: string[] = []

    for (const specifier of collectSpecifiers(
      file,
      readFileSync(path.join(ctx.pkgDir, file), 'utf8'),
    )) {
      if (specifier.startsWith('.')) {
        // declarations import `./x.mjs`, which TypeScript resolves to `./x.d.mts`
        const target = path.join(
          path.dirname(file),
          file.endsWith('.d.mts') ? specifier.replace(/\.mjs$/, '.d.mts') : specifier,
        )

        if (!files.has(target)) {
          errors.push(`${file} imports "${specifier}" which is not an emitted file`)
        }

        relativeImports.push(target)
      } else if (!isBuiltin(specifier)) {
        const packageName = specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

        if (!allowed.has(packageName)) {
          errors.push(
            `${file} imports "${specifier}" but "${packageName}" is not in dependencies or peerDependencies`,
          )
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
      errors.push(
        `import cycle ${[...stack.slice(stack.indexOf(file)), file].join(' -> ')}, move shared values into a leaf module`,
      )
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

  const exportTargets = Object.values(pkg.publishConfig?.exports ?? {}).flatMap((target) =>
    typeof target === 'string' ? target : Object.values(target),
  )

  for (const target of [
    ...exportTargets,
    ...(Array.isArray(pkg.sideEffects) ? pkg.sideEffects : []),
  ]) {
    if (!existsSync(path.join(ctx.pkgDir, target))) {
      errors.push(`${target} is referenced in package.json but was not emitted`)
    }
  }

  if (errors.length) {
    throw new Error(
      `[verify-dist] ${pkg.name}:\n${errors.map((error) => `  - ${error}`).join('\n')}`,
    )
  }
}

/**
 * Specifiers of imports/exports, `import('x')` calls and types, `declare module 'x'` and `/// <reference types="x" />`.
 * (`ts.preProcessFile` would be shorter but misses `export * as ns from 'x'`.)
 */
function collectSpecifiers(fileName: string, code: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest)
  const specifiers = sourceFile.typeReferenceDirectives.map((reference) => reference.fileName)

  const visit = (node: ts.Node): void => {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : ts.isModuleDeclaration(node)
              ? node.name
              : undefined

    if (specifier && ts.isStringLiteralLike(specifier)) {
      specifiers.push(specifier.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return specifiers
}
