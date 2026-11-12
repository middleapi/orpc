import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import type { SourceFile } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
  Diagnostic,
  JSDocTagInfo,
  Program,
  Symbol as TSSymbol,
  Type,
} from 'typescript/unstable/sync'
import {
  DiagnosticCategory,
  ObjectFlags,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
} from 'typescript/unstable/sync'

import type { TypeScriptProject } from './project'

export interface JSDoc {
  comment: string
  tags: readonly JSDocTagInfo[]
}

/**
 * Where a file comes from: the project (also workspace packages linked into `node_modules`),
 * an external library (`node_modules`), or the default library (`lib.*.d.ts`).
 */
export type SourceKind = 'project' | 'external' | 'default'

export function createSourceKindChecker(program: Program): (path: string) => SourceKind {
  const cache = new Map<string, SourceKind>()

  return (path) => {
    let kind = cache.get(path)

    if (kind === undefined) {
      const metadata = program.getSourceFileMetadataByPath(path as any)
      // a workspace package linked into `node_modules` (`@acme/db` -> `packages/db`)
      // is resolved to its real path outside of it, and belongs to the project
      kind = metadata?.isDefaultLibrary
        ? 'default'
        : metadata?.isFromExternalLibrary && path.includes('/node_modules/')
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
 * For a property assigned from a variable, like `{ ping }`, `{ ping: pingProcedure }`,
 * or `{ ping: routers.ping }` with `import * as routers`, returns the variable's symbol
 * (following imports), which carries its JSDoc.
 */
export function getAssignedSymbol(checker: Checker, symbol: TSSymbol): TSSymbol | undefined {
  for (const declaration of symbol.declarations) {
    const node = declaration.resolve() as any

    let assigned: TSSymbol | undefined

    if (node?.kind === SyntaxKind.ShorthandPropertyAssignment) {
      assigned = checker.getShorthandAssignmentValueSymbol(node)
    } else if (node?.kind === SyntaxKind.PropertyAssignment) {
      const initializer = node.initializer

      if (initializer?.kind === SyntaxKind.Identifier) {
        assigned = checker.getSymbolAtLocation(initializer)
      } else if (initializer?.kind === SyntaxKind.PropertyAccessExpression) {
        assigned = checker.getSymbolAtLocation(initializer.name)
      }
    }

    if (assigned) {
      return resolveAlias(checker, assigned)
    }
  }

  return undefined
}

/**
 * For a procedure built from an implementer, like `os.todo.get.handler(...)` with
 * `const os = implement(contract)`, returns the implemented property (`get`),
 * which keeps the contract's declaration and JSDoc. The procedure can be a router property
 * or a variable (`const get = os.todo.get.handler(...)`).
 */
export function getImplementedSymbol(checker: Checker, symbol: TSSymbol): TSSymbol | undefined {
  const node = symbol.declarations[0]?.resolve() as any
  let expression =
    node?.kind === SyntaxKind.PropertyAssignment || node?.kind === SyntaxKind.VariableDeclaration
      ? node.initializer
      : undefined

  // walk down `.handler(...)`, `.use(...)`, and other builder calls to the implementer property.
  // Called properties are builder methods or helpers (`withAuth(...)`), so they are skipped
  // without asking the compiler.
  let callee = false

  for (let depth = 0; expression && depth < 32; depth++) {
    if (expression.kind === SyntaxKind.CallExpression) {
      expression = expression.expression
      callee = true
    } else if (expression.kind === SyntaxKind.PropertyAccessExpression) {
      if (!callee) {
        const property = checker.getSymbolAtLocation(expression.name)

        if (!property || !(property.flags & SymbolFlags.Property) || property.id === symbol.id) {
          return undefined
        }

        // implementer properties are mapped from contract procedures, declared without `.handler`.
        // A builder (`procedures.authed`, also of a generic factory) is declared with it.
        const declaration = property.declarations[0]?.resolve() as any
        const declared = declaration?.name && checker.getSymbolAtLocation(declaration.name)
        const declaredType = declared && checker.getTypeOfSymbol(declared)

        return declaredType && !checker.getPropertyOfType(declaredType, 'handler')
          ? property
          : undefined
      }

      expression = expression.expression
      callee = false
    } else {
      return undefined
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

function getPropertyType(checker: Checker, type: Type, name: string): Type | undefined {
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
  /** The types of the yielded values, one per `{ done: false }` result of `next()` */
  yieldTypes: Type[]
  /** The types of the returned values, one per `{ done: true }` result of `next()` */
  returnTypes: Type[]
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

  const yieldTypes: Type[] = []
  const returnTypes: Type[] = []

  for (const member of result?.isUnionType() ? result.getTypes() : result ? [result] : []) {
    const done = getPropertyType(checker, member, 'done')
    const value = getPropertyType(checker, member, 'value')

    if (!done || !value) {
      continue
    }

    if (done.flags & TypeFlags.BooleanLiteral && (done as any).value === true) {
      returnTypes.push(value)
    } else {
      yieldTypes.push(value)
    }
  }

  return yieldTypes.length ? { yieldTypes, returnTypes } : undefined
}

/**
 * Resolves a path relative to the current working directory, or a `file:` URL.
 */
export function toAbsolutePath(file: string | URL): string {
  const filePath = file instanceof URL || file.startsWith('file:') ? fileURLToPath(file) : file
  return path.resolve(process.cwd(), filePath)
}

/**
 * The project of a source file of a loaded program (see `openTypeScriptProject`).
 */
export function createTypeScriptProject(
  file: string,
  checker: Checker,
  program: Program,
  sourceFile: SourceFile,
  close: () => void,
  describeConfig: () => readonly string[],
): TypeScriptProject {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []

  return {
    checker,
    program,
    sourceFile,
    getExportType(name) {
      const exported = exports.find((s) => s.name === name)

      if (!exported) {
        const names = exports.map((s) => s.name)
        const hint = names.includes('default')
          ? ` Use export: 'default' for the default export.`
          : ''
        throw new Error(
          `[TypeScript] "${file}" has no export named "${name}". Available exports: ${names.join(', ') || '(none)'}.${hint}`,
        )
      }

      const symbol = resolveAlias(checker, exported)

      // classes and enums are both, their declared type is the instance/member type
      const type =
        symbol.flags & SymbolFlags.Type
          ? checker.getDeclaredTypeOfSymbol(symbol)
          : checker.getTypeOfSymbol(symbol)

      // the compiler knows why: a missing module, or a tsconfig "paths" alias it does not map
      if (!type || type.isErrorType()) {
        const errors = [
          ...describeConfig(),
          ...[
            ...program.getSyntacticDiagnostics(sourceFile.fileName),
            ...program.getSemanticDiagnostics(sourceFile.fileName),
          ]
            .filter((d) => d.category === DiagnosticCategory.Error)
            .map((d) => formatDiagnostic(program, d)),
        ]

        throw new Error(
          `[TypeScript] Could not resolve the type of "${name}" in "${file}". Check its import, and the tsconfig "paths" for aliases like "@/".\n\nCompiler errors:${errors.map((e) => `\n  ${e}`).join('')}`,
        )
      }

      return { type, symbol }
    },
    describeConfig,
    close,
  }
}

/**
 * Formats a diagnostic like `tsc`: `file:line:column - error TS2304: Cannot find name 'x'.`
 */
export function formatDiagnostic(program: Program, diagnostic: Diagnostic): string {
  const message = `error TS${diagnostic.code}: ${diagnostic.text}`
  const sourceFile = diagnostic.fileName ? program.getSourceFile(diagnostic.fileName) : undefined

  if (!sourceFile) {
    return diagnostic.fileName ? `${diagnostic.fileName} - ${message}` : message
  }

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.pos)
  return `${diagnostic.fileName}:${line + 1}:${character + 1} - ${message}`
}
