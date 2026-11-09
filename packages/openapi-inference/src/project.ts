import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import type { SourceFile } from 'typescript/unstable/ast'
import type { Checker, Program, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { API, SymbolFlags } from 'typescript/unstable/sync'

export interface TypeScriptProjectOptions {
  /**
   * The source file to analyze, relative to the current working directory.
   *
   * @example './src/router.ts'
   * @example new URL('./router.ts', import.meta.url)
   */
  file: string | URL

  /**
   * The `tsconfig.json` of the project. Its `paths` resolve aliased imports like `@/`.
   *
   * @default the nearest `tsconfig.json` that includes `file`
   */
  tsconfig?: string | URL | undefined
}

export interface TypeScriptExport {
  type: Type
  /** The exported symbol, carrying its JSDoc */
  symbol: TSSymbol
}

export interface TypeScriptProject {
  checker: Checker
  program: Program
  sourceFile: SourceFile

  /**
   * Resolves the type of an export of the file, use `default` for a default export.
   * Value exports (`export const router`) resolve to their type (`typeof router`),
   * type exports (`export type Router`, `export interface User`) to the declared type.
   */
  getExportType(name: string): TypeScriptExport

  /**
   * Stops the compiler process.
   */
  close(): void
}

/**
 * Starts the TypeScript 7 compiler (`tsgo`) for the project containing `options.file`.
 *
 * Call `close()` when done, otherwise the compiler process keeps running.
 *
 * @see {@link https://orpc.dev/docs/openapi/type-inference#converting-types-directly | OpenAPI Type Inference - Converting Types Directly}
 */
export function openTypeScriptProject(options: TypeScriptProjectOptions): TypeScriptProject {
  const file = toAbsolutePath(options.file)
  const tsconfig = options.tsconfig === undefined ? undefined : toAbsolutePath(options.tsconfig)

  if (!existsSync(file)) {
    throw new Error(`[TypeScript] File "${file}" does not exist.`)
  }

  const api = new API({ cwd: path.dirname(tsconfig ?? file) })

  try {
    let snapshot = api.updateSnapshot(
      tsconfig ? { openProjects: [tsconfig] } : { openFiles: [file] },
    )

    let project = tsconfig ? snapshot.getProject(tsconfig) : snapshot.getDefaultProjectForFile(file)

    // the nearest tsconfig.json may not include the file (e.g. `include: ["src"]` for a script),
    // look further up for one that does before settling for default compiler options
    if (!tsconfig && project?.configFileName.startsWith('/dev/null/')) {
      for (const candidate of findAncestorTsconfigs(path.dirname(file))) {
        snapshot = api.updateSnapshot({ openProjects: [candidate] })
        const candidateProject = snapshot.getProject(candidate)

        if (candidateProject?.program.getSourceFile(file)) {
          project = candidateProject
          break
        }
      }
    }

    if (!project) {
      throw new Error(`[TypeScript] Could not load the project for "${tsconfig ?? file}".`)
    }

    const sourceFile = project.program.getSourceFile(file)

    if (!sourceFile) {
      throw new Error(
        `[TypeScript] "${file}" is not part of the project "${project.configFileName}".`,
      )
    }

    const checker = project.checker
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []

    return {
      checker,
      program: project.program,
      sourceFile,
      getExportType(name) {
        const exported = exports.find((s) => s.name === name)

        if (!exported) {
          throw new Error(`[TypeScript] "${file}" has no export named "${name}".`)
        }

        const symbol =
          exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported

        // classes and enums are both, their declared type is the instance/member type
        const type =
          symbol.flags & SymbolFlags.Type
            ? checker.getDeclaredTypeOfSymbol(symbol)
            : checker.getTypeOfSymbol(symbol)

        if (!type || type.isErrorType()) {
          throw new Error(`[TypeScript] Could not resolve the type of "${name}" in "${file}".`)
        }

        return { type, symbol }
      },
      close: () => api.close(),
    }
  } catch (error) {
    api.close()
    throw error
  }
}

function* findAncestorTsconfigs(directory: string): Generator<string> {
  for (let current = directory; ; current = path.dirname(current)) {
    const candidate = path.join(current, 'tsconfig.json')

    if (existsSync(candidate)) {
      yield candidate
    }

    if (path.dirname(current) === current) {
      return
    }
  }
}

function toAbsolutePath(file: string | URL): string {
  const filePath = file instanceof URL || file.startsWith('file:') ? fileURLToPath(file) : file
  return path.resolve(process.cwd(), filePath)
}
