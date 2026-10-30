import { existsSync, globSync, readFileSync } from 'node:fs'
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
  optionalDependencies?: Record<string, string>
  sideEffects?: boolean | string[]
  publishConfig?: { exports?: Record<string, unknown> }
}

/**
 * Runs after obuild, which does not check any of these, so `prepack` fails instead of publishing a broken package:
 *
 * - every bare import in `dist` (runtime and type-level) is declared in `dependencies` or `peerDependencies`
 * - every `.mjs` has a `.d.mts` (obuild only warns when a file fails `isolatedDeclarations`)
 * - every path in `publishConfig.exports` and `sideEffects` exists
 */
export function verifyDist({ pkgDir }: { pkgDir: string }, options: VerifyDistOptions = {}): void {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as PackageJson
  const allowed = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...options.externals ?? [],
  ])

  const errors: string[] = []

  const files = globSync('dist/**/*.{mjs,d.mts}', { cwd: pkgDir })

  for (const file of files) {
    if (file.endsWith('.mjs') && !files.includes(file.replace(/\.mjs$/, '.d.mts'))) {
      errors.push(`${file} has no declaration file, it probably fails \`isolatedDeclarations\``)
    }

    const { importedFiles } = ts.preProcessFile(readFileSync(path.join(pkgDir, file), 'utf8'), true, true)

    for (const { fileName: specifier } of importedFiles) {
      if (specifier.startsWith('.') || isBuiltin(specifier)) {
        continue
      }

      const packageName = specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

      if (!allowed.has(packageName)) {
        errors.push(`${file} imports "${specifier}" but "${packageName}" is not in dependencies or peerDependencies`)
      }
    }
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

function collectExportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(collectExportTargets)
  }

  return []
}
