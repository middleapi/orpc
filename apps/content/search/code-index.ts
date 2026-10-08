/**
 * Blume's search index strips fenced code before indexing (`toPlainText` in
 * `blume/src/search/documents.ts`), so a query like `createSafeClient` or
 * `onSuccess` only matches pages that also happen to name it in prose. On oRPC's
 * docs that hides most of the answer: the pages are code-first, and the snippet
 * a reader is hunting for usually lives inside a ```ts fence.
 *
 * The generated `/blume-search.json` endpoint imports the index from Blume's
 * `blume:search-index` virtual module, so a transform of that module can fold
 * the code back in before it is served. The full Markdown for every route is
 * published beside it as `blume:raw-markdown` (Blume serves it for the raw `.md`
 * URLs), which is where the fences come from — no second content pass. Both are
 * read from Blume's runtime-module registry, which the CLI fills before it starts
 * Astro in the same process.
 *
 * Working on the generated module rather than a fork of Blume's document builder
 * keeps this to one hook: the index keeps its shape, and Orama, FlexSearch, the
 * preview pane and the hosted syncs all read the enriched `content` unchanged.
 */

import type { Plugin } from 'vite'
import { stringifyJSON } from '@orpc/shared'

/** The resolved id of the virtual module this plugin rewrites (Rollup's `\0` prefix). */
const SEARCH_INDEX_ID = '\0blume:search-index'

/**
 * Where Blume keeps the published runtime modules: on `globalThis` under this
 * well-known symbol, so the CLI and every copy of `blume/astro` share one map.
 * `readRuntimeModule` from `blume/astro` reads the same map, but that export
 * ships no type declarations, so importing it would pull Blume's TypeScript
 * sources into the repo's type check.
 */
const RUNTIME_MODULES = Symbol.for('blume.runtime-modules')

function readRuntimeModule(id: string): string | undefined {
  const registry = (globalThis as { [RUNTIME_MODULES]?: { modules?: Map<string, string> } })[RUNTIME_MODULES]
  return registry?.modules?.get(id)
}

/**
 * Opening fence, its info string, body, and closing fence of the same length.
 * The info string cannot open with a backtick, so it can never absorb part of
 * the opening run — the ambiguity that would let a long line of backticks
 * backtrack quadratically.
 */
const FENCE = /^[ \t]*(?<ticks>`{3,})(?<info>(?:[^\n`][^\n]*)?)\n(?<body>[\s\S]*?)^[ \t]*\k<ticks>[ \t]*$/gmu

/**
 * Fence bodies Blume renders as something other than code, so their text is
 * chrome rather than content: `package-install` expands to a tabbed install
 * widget, and Mermaid to a diagram.
 */
const NON_CODE_LANGUAGES = new Set(['mermaid', 'package-install'])

/** Shiki transformer notations (`// [!code highlight]`) — markup, not code. */
const NOTATION = /\s*(?:\/\/|#|<!--)\s*\[!code[^\]]*\][^\n]*/gu
/** Twoslash directives and query markers, which name compiler flags, not API. */
const TWOSLASH_LINE = /^[ \t]*\/\/[ \t]*(?:@[a-zA-Z]|-{3}cut|\^[?^|])[^\n]*$/gmu
/** A fence's info string: language first, then meta such as `twoslash` or a title. */
const INFO_LANGUAGE = /^[a-zA-Z0-9-]+/u

/** The fields of a search document this plugin reads and rewrites. */
interface IndexedDocument {
  route: string
  content: string
}

/**
 * Pull the indexable text out of one page's Markdown: every fenced block that
 * renders as code, stripped of the annotations that drive rendering.
 *
 * Lines are deduplicated per page. Docs pages repeat the same imports and
 * `const router = { ... }` scaffolding across a dozen examples, and Orama scores
 * a bag of words — the repeats add weight to boilerplate and bytes to the index
 * the browser downloads, without making any page easier to find.
 */
function extractCode(markdown: string): string {
  const lines = new Set<string>()

  for (const match of markdown.matchAll(FENCE)) {
    const info = match.groups?.info ?? ''
    const language = INFO_LANGUAGE.exec(info.trim())?.[0]?.toLowerCase() ?? ''
    if (NON_CODE_LANGUAGES.has(language)) {
      continue
    }

    const body = (match.groups?.body ?? '')
      .replaceAll(TWOSLASH_LINE, '')
      .replaceAll(NOTATION, '')

    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) {
        lines.add(trimmed)
      }
    }
  }

  return [...lines].join('\n')
}

/**
 * Fold each page's fenced code into its search document, so code is searchable
 * and the preview pane can find the block a query matched.
 */
export function searchCodeIndexPlugin(): Plugin {
  return {
    name: 'orpc:search-code-index',
    transform(_code, id) {
      if (id !== SEARCH_INDEX_ID) {
        return null
      }

      // The module only wraps the published JSON text in `JSON.parse`, so
      // rebuild it from the same text rather than parsing the generated code.
      const index = readRuntimeModule('blume:search-index')
      const markdown = readRuntimeModule('blume:raw-markdown')
      if (index === undefined || markdown === undefined) {
        // Fail loudly: skipping would silently drop code from search again.
        this.error('Blume\'s published search index or raw Markdown was not found; update search/code-index.ts for this Blume version.')
      }

      const raw = JSON.parse(markdown) as Record<string, { mdx?: string }>

      // Rewritten in place: the documents were just parsed here, so nothing else
      // holds a reference for a copy to protect.
      const documents = JSON.parse(index) as IndexedDocument[]
      for (const doc of documents) {
        const source = raw[doc.route]?.mdx
        const extracted = source ? extractCode(source) : ''
        if (extracted) {
          doc.content = `${doc.content}\n${extracted}`
        }
      }

      return { code: `export default JSON.parse(${stringifyJSON(stringifyJSON(documents))});\n`, map: null }
    },
  }
}
