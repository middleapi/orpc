import { SyntaxKind } from 'typescript/unstable/ast'
import type { Checker, JSDocTagInfo, Program, Symbol as TSSymbol } from 'typescript/unstable/sync'
import { SymbolFlags } from 'typescript/unstable/sync'

export interface JSDoc {
  comment: string
  tags: readonly JSDocTagInfo[]
}

/**
 * Returns whether a file is part of the default library or an external library (`node_modules`).
 */
export function createLibraryPathChecker(program: Program): (path: string) => boolean {
  const cache = new Map<string, boolean>()

  return (path) => {
    let isLibrary = cache.get(path)

    if (isLibrary === undefined) {
      const metadata = program.getSourceFileMetadataByPath(path as any)
      isLibrary = Boolean(metadata?.isDefaultLibrary || metadata?.isFromExternalLibrary)
      cache.set(path, isLibrary)
    }

    return isLibrary
  }
}

/**
 * Reads the JSDoc comment and tags of a symbol.
 *
 * Declarations in project files are checked for JSDoc locally first (on the node or its
 * statement, e.g. `/** ... *\/ export const router`), which skips two compiler requests for
 * the common symbol without JSDoc. Library files are not loaded, the compiler is asked directly.
 */
export function getJSDoc(
  checker: Checker,
  symbol: TSSymbol,
  isLibraryPath: (path: string) => boolean,
): JSDoc | undefined {
  const mayHaveJSDoc = symbol.declarations.some((declaration) => {
    if (isLibraryPath(declaration.path)) {
      return true
    }

    const node = declaration.resolve()

    if (!node) {
      return true
    }

    return [node, node.parent, node.parent?.parent].some((n) => Boolean(n?.jsDoc?.length))
  })

  if (!mayHaveJSDoc) {
    return undefined
  }

  const comment = checker.getDocumentationCommentOfSymbol(symbol).trim()
  const tags = checker.getJsDocTagsOfSymbol(symbol)

  return comment || tags.length ? { comment, tags } : undefined
}

/**
 * For a property assigned from a variable, like `{ ping }` or `{ ping: pingProcedure }`,
 * returns the variable's symbol (following imports), which carries its JSDoc.
 */
export function getAssignedSymbol(checker: Checker, symbol: TSSymbol): TSSymbol | undefined {
  for (const declaration of symbol.declarations) {
    const node = declaration.resolve() as any

    let assigned: TSSymbol | undefined

    if (node?.kind === SyntaxKind.ShorthandPropertyAssignment) {
      assigned = checker.getShorthandAssignmentValueSymbol(node)
    } else if (
      node?.kind === SyntaxKind.PropertyAssignment &&
      node.initializer?.kind === SyntaxKind.Identifier
    ) {
      assigned = checker.getSymbolAtLocation(node.initializer)
    }

    if (assigned) {
      return assigned.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(assigned) : assigned
    }
  }

  return undefined
}
