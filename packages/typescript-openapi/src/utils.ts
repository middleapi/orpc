import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
  JSDocTagInfo,
  Program,
  Symbol as TSSymbol,
  Type,
} from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

export interface JSDoc {
  comment: string
  tags: readonly JSDocTagInfo[]
}

/**
 * Where a file comes from: the project, an external library (`node_modules`),
 * or the default library (`lib.*.d.ts`).
 */
export type SourceKind = 'project' | 'external' | 'default'

export function createSourceKindChecker(program: Program): (path: string) => SourceKind {
  const cache = new Map<string, SourceKind>()

  return (path) => {
    let kind = cache.get(path)

    if (kind === undefined) {
      const metadata = program.getSourceFileMetadataByPath(path as any)
      kind = metadata?.isDefaultLibrary
        ? 'default'
        : metadata?.isFromExternalLibrary
          ? 'external'
          : 'project'
      cache.set(path, kind)
    }

    return kind
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
  getSourceKind: (path: string) => SourceKind,
): JSDoc | undefined {
  const mayHaveJSDoc = symbol.declarations.some((declaration) => {
    if (getSourceKind(declaration.path) !== 'project') {
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
      return resolveAlias(checker, assigned)
    }
  }

  return undefined
}

export function resolveAlias(checker: Checker, symbol: TSSymbol): TSSymbol {
  return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

/**
 * Arrays and tuples are type references, checking it locally saves compiler requests.
 */
export function isTypeReference(type: Type): boolean {
  return Boolean(type.flags & TypeFlags.Object && (type as any).objectFlags & ObjectFlags.Reference)
}

/**
 * Class accessors live on the prototype, so JSON serialization skips them.
 * Accessors of object literals and interfaces describe own data and are kept.
 */
export function isClassAccessor(symbol: TSSymbol): boolean {
  if (!(symbol.flags & SymbolFlags.Accessor) || symbol.flags & SymbolFlags.Property) {
    return false
  }

  return symbol.declarations.every((declaration) => {
    const kind = declaration.resolve()?.parent?.kind
    return kind === SyntaxKind.ClassDeclaration || kind === SyntaxKind.ClassExpression
  })
}

export function getPropertyType(checker: Checker, type: Type, name: string): Type | undefined {
  const property = checker.getPropertyOfType(type, name)
  return property && checker.getTypeOfSymbol(property)
}

export function getCallReturnType(checker: Checker, type: Type | undefined): Type | undefined {
  const signature = type && checker.getSignaturesOfType(type, SignatureKind.Call)[0]
  return signature && checker.getReturnTypeOfSignature(signature)
}

/**
 * The `T` of `Promise<T>`.
 */
export function getPromisedType(checker: Checker, type: Type): Type | undefined {
  return type.isTypeReference() ? checker.getTypeArguments(type)[0] : undefined
}

export interface IteratorTypes {
  yieldType: Type
  returnType: Type | undefined
}

/**
 * The yield and return types of a (async) iterable, read through
 * `[Symbol.iterator]().next()` or `[Symbol.asyncIterator]().next()`.
 */
export function getIteratorTypes(
  checker: Checker,
  type: Type,
  properties: readonly TSSymbol[],
  isAsync: boolean,
): IteratorTypes | undefined {
  const prefix = isAsync ? '__@asyncIterator@' : '__@iterator@'
  const iteratorProperty = properties.find((p) => p.escapedName.startsWith(prefix))

  if (!iteratorProperty) {
    return undefined
  }

  const iterator = getCallReturnType(checker, checker.getTypeOfSymbol(iteratorProperty))
  const next = iterator && checker.getPropertyOfType(iterator, 'next')
  const returned = next && getCallReturnType(checker, checker.getTypeOfSymbol(next))
  const result = isAsync && returned ? getPromisedType(checker, returned) : returned

  let yieldType: Type | undefined
  let returnType: Type | undefined

  for (const member of result?.isUnionType() ? result.getTypes() : result ? [result] : []) {
    const done = getPropertyType(checker, member, 'done')
    const value = getPropertyType(checker, member, 'value')

    if (!done || !value) {
      continue
    }

    if (done.flags & TypeFlags.BooleanLiteral && (done as any).value === true) {
      returnType = value
    } else {
      yieldType = value
    }
  }

  return yieldType ? { yieldType, returnType } : undefined
}
