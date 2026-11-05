/**
 * Runs after `tsc` in each package's `prepack` (cwd is the package directory),
 * so `prepack` fails instead of publishing a broken package:
 *
 * - every bare import in `dist` (runtime and type-level) is declared in `dependencies` or `peerDependencies`
 * - every relative import in `dist` points to a file that is published (an emitted file or `package.json`)
 * - no runtime import cycle exists between `dist` files (it causes evaluation-order issues)
 * - every path in `publishConfig.exports` and `sideEffects` exists
 *
 * `tsc` already guarantees the rest (declarations for every file, rewritten relative extensions).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { parseSync } from 'oxc-parser'

/** Bare specifiers provided by the runtime rather than by `node_modules`. */
const RUNTIME_MODULES = new Set(['bun', 'cloudflare:workers'])

interface PackageJson {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  sideEffects?: boolean | string[]
  publishConfig?: { exports?: Record<string, string | Record<string, string>> }
}

interface AstNode {
  type: string
  [key: string]: unknown
}

const pkgDir = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as PackageJson
const allowed = new Set([pkg.name, ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })])
const errors: string[] = []

const files = new Set(
  readdirSync(path.join(pkgDir, 'dist'), { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.js') || file.endsWith('.d.ts'))
    .map(file => path.join('dist', file)),
)
const runtimeImports = new Map<string, string[]>()

for (const file of files) {
  const relativeImports: string[] = []

  for (const specifier of collectSpecifiers(file, readFileSync(path.join(pkgDir, file), 'utf8'))) {
    if (specifier.startsWith('.')) {
      // declarations keep the source `./x.ts` (or `./x.js`), which TypeScript resolves to `./x.d.ts`
      const target = path.join(path.dirname(file), file.endsWith('.d.ts') ? specifier.replace(/\.(?:tsx?|js)$/, '.d.ts') : specifier)

      if (!files.has(target) && target !== 'package.json') {
        errors.push(`${file} imports "${specifier}" which is not an emitted file`)
      }

      relativeImports.push(target)
    }
    else if (!isBuiltin(specifier) && !RUNTIME_MODULES.has(specifier)) {
      const packageName = specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

      if (!allowed.has(packageName)) {
        errors.push(`${file} imports "${specifier}" but "${packageName}" is not in dependencies or peerDependencies`)
      }
    }
  }

  if (file.endsWith('.js')) {
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
  if (!existsSync(path.join(pkgDir, target))) {
    errors.push(`${target} is referenced in package.json but was not emitted`)
  }
}

if (errors.length) {
  console.error(`[verify-dist] ${pkg.name}:\n${errors.map(error => `  - ${error}`).join('\n')}`)
  process.exit(1)
}

/**
 * Specifiers of imports/exports, `import('x')` calls and types, `declare module 'x'` and `/// <reference types="x" />`.
 */
function collectSpecifiers(fileName: string, code: string): string[] {
  const { program, comments, errors: parseErrors } = parseSync(fileName, code)

  if (parseErrors.length) {
    errors.push(`${fileName} could not be parsed: ${parseErrors[0]!.message}`)
  }

  const specifiers = comments.flatMap((comment) => {
    const match = /^\/\s*<reference\s+types="([^"]+)"/.exec(comment.value)
    return match ? [match[1]!] : []
  })

  const addLiteral = (node: unknown): void => {
    const literal = node as AstNode | null | undefined
    if (literal?.type === 'Literal' && typeof literal.value === 'string') {
      specifiers.push(literal.value)
    }
  }

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }

    if (value === null || typeof value !== 'object') {
      return
    }

    const node = value as AstNode

    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
      case 'ImportExpression':
      case 'TSImportType':
        addLiteral(node.source)
        break
      case 'TSModuleDeclaration':
        addLiteral(node.id)
        break
    }

    Object.values(node).forEach(walk)
  }

  walk(program)

  return specifiers
}
