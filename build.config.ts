// Builds the package in the current directory: every package's `prepack` runs `node ../../build.config.ts`,
// since obuild's CLI only reads a `build.config.ts` next to the package.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'

import { build } from 'obuild'
import ts from 'typescript-6'

// provided by the runtime rather than `node_modules`, like `scheme:` specifiers (`cloudflare:workers`)
const RUNTIME_MODULES = new Set(['bun'])

interface PackageJson {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  sideEffects?: boolean | string[]
  publishConfig?: { exports?: Record<string, string | Record<string, string>> }
}

await build({
  entries: [
    {
      type: 'transform',
      input: './src',
      outDir: './dist',
      filter: (file) => !/\.test(?:-d)?\.|__tests__\//.test(file),
      // applies the package's tsconfig.json, e.g. the legacy decorators of @orpc/nest
      oxc: { tsconfig: true },
    },
  ],
  hooks: {
    end(ctx) {
      const files = listDist(ctx.pkgDir)
      inlineJsonImports(ctx.pkgDir, files)
      verifyDist(ctx.pkgDir, ctx.pkg as PackageJson, files)
    },
  },
})

function listDist(pkgDir: string): string[] {
  return readdirSync(path.join(pkgDir, 'dist'), { recursive: true, encoding: 'utf8' })
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
function inlineJsonImports(pkgDir: string, files: string[]): void {
  for (const file of files.filter((file) => file.endsWith('.mjs'))) {
    const absolutePath = path.join(pkgDir, file)
    const code = readFileSync(absolutePath, 'utf8')

    if (!code.includes('json')) {
      continue
    }

    const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
    let updated = code

    for (const statement of sourceFile.statements.toReversed()) {
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
          `[inline-json] ${file} imports "${specifier}", only default imports of relative JSON files can be inlined`,
        )
      }

      const json: unknown = JSON.parse(
        readFileSync(path.resolve(path.dirname(absolutePath), specifier), 'utf8'),
      )
      const value = pickReadProperties(sourceFile, statement, binding.name.text, json)

      updated =
        updated.slice(0, statement.getStart(sourceFile)) +
        // oxlint-disable-next-line no-restricted-properties -- a parsed JSON value always stringifies
        `const ${binding.name.text} = ${JSON.stringify(value)};` +
        updated.slice(statement.end)
    }

    if (updated !== code) {
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
 * Fails `prepack` instead of publishing a broken package: obuild only warns when a file fails
 * `isolatedDeclarations` (leaving it without a `.d.mts`), does not rewrite dynamic imports,
 * and does not check imports against `package.json`.
 */
function verifyDist(pkgDir: string, pkg: PackageJson, files: string[]): void {
  const allowed = new Set([
    pkg.name,
    ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }),
  ])
  const emitted = new Set(files)
  const errors: string[] = []

  for (const file of files) {
    if (file.endsWith('.mjs') && !emitted.has(file.replace(/\.mjs$/, '.d.mts'))) {
      errors.push(`${file} has no declaration file, it probably fails \`isolatedDeclarations\``)
    }

    for (const specifier of collectSpecifiers(
      file,
      readFileSync(path.join(pkgDir, file), 'utf8'),
    )) {
      if (specifier.startsWith('.')) {
        // declarations import `./x.mjs`, which TypeScript resolves to `./x.d.mts`
        const target = path.join(
          path.dirname(file),
          file.endsWith('.d.mts') ? specifier.replace(/\.mjs$/, '.d.mts') : specifier,
        )

        if (!emitted.has(target)) {
          errors.push(`${file} imports "${specifier}" which is not an emitted file`)
        }
      } else if (!isBuiltin(specifier) && !/^[a-z][\w+.-]*:/.test(specifier)) {
        const packageName = specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

        if (!allowed.has(packageName) && !RUNTIME_MODULES.has(packageName)) {
          errors.push(
            `${file} imports "${specifier}" but "${packageName}" is not in dependencies or peerDependencies`,
          )
        }
      }
    }
  }

  const exportTargets = Object.values(pkg.publishConfig?.exports ?? {}).flatMap((target) =>
    typeof target === 'string' ? target : Object.values(target),
  )

  for (const target of [
    ...exportTargets,
    ...(Array.isArray(pkg.sideEffects) ? pkg.sideEffects : []),
  ]) {
    if (!existsSync(path.join(pkgDir, target))) {
      errors.push(`${target} is referenced in package.json but was not emitted`)
    }
  }

  if (errors.length) {
    throw new Error(
      `[verify-dist] ${pkg.name}:\n${errors.map((error) => `  - ${error}`).join('\n')}`,
    )
  }
}

// `ts.preProcessFile` would be shorter but misses `export * as ns from 'x'`
function collectSpecifiers(fileName: string, code: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest)
  const specifiers = sourceFile.typeReferenceDirectives.map((reference) => reference.fileName)

  const visit = (node: ts.Node): void => {
    let specifier: ts.Node | undefined

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0]
    } else if (ts.isModuleDeclaration(node)) {
      specifier = node.name
    }

    if (specifier && ts.isStringLiteralLike(specifier)) {
      specifiers.push(specifier.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return specifiers
}
