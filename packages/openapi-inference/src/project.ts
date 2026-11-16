import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import type { SourceFile } from 'typescript/unstable/ast'
import type { Checker, Program, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { API, DiagnosticCategory } from 'typescript/unstable/sync'

import { createTypeScriptProject, formatDiagnostic, toAbsolutePath } from './utils'

/** The extensions of the files TypeScript parses, also of declaration files (`.d.ts`) */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
])

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
   * Where the compiler options come from, the tsconfig used or default options, with their errors,
   * and the errors of a nearer tsconfig that does not include the file.
   */
  describeConfig(): readonly string[]

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

  // the compiler process can not parse other files (`.vue`), and stops
  if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    throw new Error(
      `[TypeScript] File "${file}" is not a TypeScript or JavaScript source file (.ts, .tsx, .mts, .cts, .js, .jsx, .mjs, .cjs).`,
    )
  }

  if (tsconfig !== undefined) {
    tsconfig = toTsconfigPath(tsconfig)

    if (!existsSync(tsconfig)) {
      throw new Error(`[TypeScript] tsconfig "${tsconfig}" does not exist.`)
    }
  }

  const api = new API({ cwd: path.dirname(tsconfig ?? file) })

  try {
    /** The project of the first tsconfig that includes the file */
    const findIncluding = (
      candidates: Iterable<string>,
      onExcluded?: (candidate: string, program: Program | undefined) => void,
    ) => {
      for (const candidate of candidates) {
        const candidateProject = api
          .updateSnapshot({ openProjects: [candidate] })
          .getProject(candidate)

        if (candidateProject?.program.getSourceFile(file)) {
          return candidateProject
        }

        onExcluded?.(candidate, candidateProject?.program)
      }

      return undefined
    }

    const snapshot = api.updateSnapshot(
      tsconfig ? { openProjects: [tsconfig] } : { openFiles: [file] },
    )

    let project = tsconfig ? snapshot.getProject(tsconfig) : snapshot.getDefaultProjectForFile(file)

    // a solution tsconfig (`"files": []` with `references`) has no files of its own,
    // the file is in one of the projects it references: the one the compiler picks for it,
    // else the first that includes it
    if (tsconfig && project && !project.rootFiles.length && !project.program.getSourceFile(file)) {
      const references = getReferencedTsconfigs(tsconfig)
      const picked = api
        .updateSnapshot({ openProjects: [tsconfig], openFiles: [file] })
        .getDefaultProjectForFile(file)
      const referenced =
        picked && references.has(path.resolve(picked.configFileName))
          ? picked
          : findIncluding(references)

      if (referenced?.program.getSourceFile(file)) {
        project = referenced
      }
    }

    const nearest = findAncestorTsconfigs(path.dirname(file)).next().value
    // the nearest tsconfig.json, when it does not include the file, with why (`No inputs were found`)
    let skipped: string[] = []

    // the nearest tsconfig.json may not include the file (e.g. `include: ["src"]` for a script),
    // look further up for one that does before settling for default compiler options
    if (!tsconfig && project && isInferred(project.configFileName)) {
      project =
        findIncluding(findAncestorTsconfigs(path.dirname(file)), (candidate, program) => {
          if (candidate === nearest) {
            skipped = [`"${candidate}" does not include "${file}".`, ...getConfigErrors(program)]
          }
        }) ?? project
    }

    if (!project) {
      throw new Error(`[TypeScript] Could not load the project for "${tsconfig ?? file}".`)
    }

    const sourceFile = project.program.getSourceFile(file)

    if (!sourceFile) {
      // unless the nearest one is the one passed, which does not include the file either
      const hint =
        tsconfig !== undefined && nearest !== undefined && nearest !== tsconfig
          ? `Pass the tsconfig that includes it, or leave out "tsconfig" to use the nearest one.`
          : 'Pass the tsconfig that includes it.'
      const errors = getConfigErrors(project.program)

      throw new Error(
        `[TypeScript] "${file}" is not part of the project "${project.configFileName}". ${hint}${errors.map((e) => `\n  ${e}`).join('')}`,
      )
    }

    const { configFileName, program } = project
    const describeConfig = () =>
      isInferred(configFileName)
        ? [...skipped, `Using default compiler options, no tsconfig.json includes "${file}".`]
        : [
            ...skipped,
            `Using the compiler options of "${configFileName}".`,
            // options the compiler rejects, like `baseUrl`
            ...getConfigErrors(program, true),
          ]

    return createTypeScriptProject(
      file,
      project.checker,
      program,
      sourceFile,
      () => api.close(),
      describeConfig,
    )
  } catch (error) {
    api.close()
    throw error
  }
}

/**
 * Whether the compiler made up the project of a file no tsconfig includes, with default options.
 */
function isInferred(configFileName: string): boolean {
  return configFileName.startsWith('/dev/null/')
}

/**
 * The errors of a tsconfig, with `all`, also of its options (`baseUrl`), not the global errors,
 * which would check the whole program.
 */
function getConfigErrors(program: Program | undefined, all = false): string[] {
  if (!program) {
    return []
  }

  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...(all ? program.getProgramDiagnostics() : []),
  ]

  return [
    ...new Set(
      diagnostics
        .filter((d) => d.category === DiagnosticCategory.Error)
        .map((d) => formatDiagnostic(program, d)),
    ),
  ]
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
 * A directory stands for its tsconfig.json, like `tsc -p <directory>` or a project reference.
 */
function toTsconfigPath(target: string): string {
  return statSync(target, { throwIfNoEntry: false })?.isDirectory()
    ? path.join(target, 'tsconfig.json')
    : target
}

/**
 * The existing tsconfigs a solution tsconfig references, also through the solutions it references.
 */
function getReferencedTsconfigs(tsconfig: string): Set<string> {
  const references = new Set<string>()
  const queue = [tsconfig]

  for (const config of queue) {
    for (const reference of readReferencePaths(config)) {
      const target = toTsconfigPath(path.resolve(path.dirname(config), reference))

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
