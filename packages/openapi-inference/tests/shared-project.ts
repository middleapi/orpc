import { fileURLToPath } from 'node:url'

import type { TypeScriptProject, TypeScriptProjectOptions } from '../src/project'
import { createTypeScriptProject, toAbsolutePath } from '../src/utils'

/**
 * Wraps `openTypeScriptProject` for tests that generate many documents from the files of one
 * fixture: the first open of a file under `root` starts the compiler, later opens of files in
 * its program reuse it. Each open gets its own checker identity, so each document gets its own
 * def names, like with a fresh compiler. Opens with a tsconfig, or of files outside the program,
 * start the compiler as usual. Call `close` when done.
 */
export function shareProjects(
  open: (options: TypeScriptProjectOptions) => TypeScriptProject,
  root: URL,
): {
  open: (options: TypeScriptProjectOptions) => TypeScriptProject
  close: () => void
} {
  const directory = fileURLToPath(root)
  let shared: TypeScriptProject | undefined

  return {
    open(options) {
      const file = toAbsolutePath(options.file)

      if (options.tsconfig !== undefined || !file.startsWith(directory)) {
        return open(options)
      }

      shared ??= open(options)
      const sourceFile = shared.program.getSourceFile(file)

      if (!sourceFile) {
        return open(options)
      }

      return createTypeScriptProject(
        file,
        new Proxy(shared.checker, {}),
        shared.program,
        sourceFile,
        () => {},
      )
    },
    close() {
      shared?.close()
      shared = undefined
    },
  }
}
