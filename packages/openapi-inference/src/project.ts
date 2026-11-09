import { existsSync, readFileSync, statSync } from 'node:fs'
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
    // the file is in one of the projects it references: the one the compiler picks for it,
    // else the first that includes it
    if (tsconfig && project && !project.rootFiles.length && !project.program.getSourceFile(file)) {
      const references = getReferencedTsconfigs(tsconfig)
      snapshot = api.updateSnapshot({ openProjects: [tsconfig], openFiles: [file] })
      let referenced = snapshot.getDefaultProjectForFile(file)

      if (!referenced || !references.has(path.resolve(referenced.configFileName))) {
        referenced = undefined

        for (const candidate of references) {
          snapshot = api.updateSnapshot({ openProjects: [candidate] })
          const candidateProject = snapshot.getProject(candidate)

          if (candidateProject?.program.getSourceFile(file)) {
            referenced = candidateProject
            break
          }
        }
      }

      if (referenced?.program.getSourceFile(file)) {
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

/**
 * The existing tsconfigs a solution tsconfig references, also through the solutions it references.
 */
function getReferencedTsconfigs(tsconfig: string): Set<string> {
  const references = new Set<string>()
  const queue = [tsconfig]

  for (const config of queue) {
    for (const reference of readReferencePaths(config)) {
      let target = path.resolve(path.dirname(config), reference)

      // a reference to a directory stands for its tsconfig.json
      if (statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
        target = path.join(target, 'tsconfig.json')
      }

      if (target !== tsconfig && !references.has(target) && existsSync(target)) {
        references.add(target)
        queue.push(target)
      }
    }
  }

  return references
}

/**
 * The `references[].path` values of a tsconfig, which is JSON with comments and trailing commas.
 */
function readReferencePaths(tsconfig: string): string[] {
  try {
    const config = JSON.parse(stripJsonComments(readFileSync(tsconfig, 'utf8')))
    const references: unknown = config?.references

    return Array.isArray(references)
      ? references.map((reference) => reference?.path).filter((p) => typeof p === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * Removes the comments and trailing commas of JSON with comments, keeping strings as they are.
 */
function stripJsonComments(text: string): string {
  return text.replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*(?:\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*[\]}])/gu,
    (_match, string: string | undefined) => string ?? '',
  )
}
