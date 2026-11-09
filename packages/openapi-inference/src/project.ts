import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import type { SourceFile } from 'typescript/unstable/ast'
import type { Checker, Program, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { API } from 'typescript/unstable/sync'

import { createTypeScriptProject, toAbsolutePath } from './utils'

export interface TypeScriptProjectOptions {
  /**
   * The source file to analyze, relative to the current working directory.
   *
   * @example './src/router.ts'
   * @example new URL('./router.ts', import.meta.url)
   */
  file: string | URL

  /**
   * The `tsconfig.json` of the project, or its directory. Its `paths` resolve aliased imports like `@/`.
   * For a solution tsconfig (`"files": []` with `references`), the referenced project including `file` is used.
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
 * @see {@link https://orpc.dev/docs/openapi/specification#converting-types-directly | OpenAPI Specification - Converting Types Directly}
 */
export function openTypeScriptProject(options: TypeScriptProjectOptions): TypeScriptProject {
  const file = toAbsolutePath(options.file)
  let tsconfig = options.tsconfig === undefined ? undefined : toAbsolutePath(options.tsconfig)

  const fileStats = statSync(file, { throwIfNoEntry: false })

  if (!fileStats) {
    throw new Error(`[TypeScript] File "${file}" does not exist.`)
  }

  if (fileStats.isDirectory()) {
    throw new Error(`[TypeScript] File "${file}" is a directory, expected a source file.`)
  }

  if (tsconfig !== undefined) {
    // a directory stands for its tsconfig.json, like `tsc -p <directory>`
    if (statSync(tsconfig, { throwIfNoEntry: false })?.isDirectory()) {
      tsconfig = path.join(tsconfig, 'tsconfig.json')
    }

    if (!existsSync(tsconfig)) {
      throw new Error(`[TypeScript] tsconfig "${tsconfig}" does not exist.`)
    }
  }

  const api = new API({ cwd: path.dirname(tsconfig ?? file) })

  try {
    let snapshot = api.updateSnapshot(
      tsconfig ? { openProjects: [tsconfig] } : { openFiles: [file] },
    )

    let project = tsconfig ? snapshot.getProject(tsconfig) : snapshot.getDefaultProjectForFile(file)

    // a solution tsconfig (`"files": []` with `references`) has no files of its own,
    // the file is in the referenced project the compiler picks for it, under the solution
    if (tsconfig && project && !project.rootFiles.length && !project.program.getSourceFile(file)) {
      snapshot = api.updateSnapshot({ openProjects: [tsconfig], openFiles: [file] })
      const referenced = snapshot.getDefaultProjectForFile(file)

      if (
        referenced &&
        !referenced.configFileName.startsWith('/dev/null/') &&
        !path.relative(path.dirname(tsconfig), referenced.configFileName).startsWith('..') &&
        referenced.program.getSourceFile(file)
      ) {
        project = referenced
      }
    }

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
        `[TypeScript] "${file}" is not part of the project "${project.configFileName}". Pass the tsconfig that includes it, or leave out "tsconfig" to use the nearest one.`,
      )
    }

    return createTypeScriptProject(file, project.checker, project.program, sourceFile, () =>
      api.close(),
    )
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
