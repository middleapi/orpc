/**
 * Blume's search index strips fenced code before indexing (`toPlainText` in
 * `blume/src/search/documents.ts`), so a query like `createSafeClient` or
 * `onSuccess` only matches pages that also happen to name it in prose. On oRPC's
 * docs that hides most of the answer: the pages are code-first, and the snippet
 * a reader is hunting for usually lives inside a ```ts fence.
 *
 * The generated index (`.blume/src/generated/search.json`) is imported through
 * Vite by the generated `/blume-search.json` endpoint, so a `pre` transform can
 * fold the code back in before it is served. The full Markdown for every route
 * sits next to it in `raw-markdown.json` (Blume generates it for the raw `.md`
 * URLs), which is where the fences come from — no second content pass.
 *
 * Working on the generated file rather than a fork of Blume's document builder
 * keeps this to one hook: the index keeps its shape, and Orama, FlexSearch, the
 * preview pane and the hosted syncs all read the enriched `content` unchanged.
 */

import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringifyJSON } from '@orpc/shared'

/** The generated module this plugin rewrites, matched against Vite's ids. */
const SEARCH_JSON = '/.blume/src/generated/search.json'
/** Sibling holding each route's full Markdown, fences included. */
const RAW_MARKDOWN = 'raw-markdown.json'

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
    // Ahead of Vite's own JSON plugin, which would otherwise hand us an ES
    // module rather than the file's JSON text.
    enforce: 'pre',
    async transform(code, id) {
      // Vite ids use `/` on every platform, and can carry a query suffix.
      if (!id.split('?')[0]!.endsWith(SEARCH_JSON)) {
        return null
      }

      const raw = JSON.parse(
        await readFile(join(dirname(id), RAW_MARKDOWN), 'utf8'),
      ) as Record<string, { mdx?: string }>

      // Rewritten in place: the documents were just parsed here, so nothing else
      // holds a reference for a copy to protect.
      const documents = JSON.parse(code) as IndexedDocument[]
      for (const doc of documents) {
        const markdown = raw[doc.route]?.mdx
        const extracted = markdown ? extractCode(markdown) : ''
        if (extracted) {
          doc.content = `${doc.content}\n${extracted}`
        }
      }

      return { code: stringifyJSON(documents), map: null }
    },
  }
}
