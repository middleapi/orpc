/**
 * The runtime half of the code search index (see `code-index.ts`): the module
 * that plugin rewrites imports this, so it runs inside the generated site, in
 * whichever Vite environment renders `/blume-search.json`. It has no imports
 * of its own for that reason.
 */

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

/** The fields of a search document this reads and rewrites. */
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
 * and the preview pane can find the block a query matched. `raw` is Blume's
 * `blume:raw-markdown` map: every route's source Markdown, fences included.
 */
export function withCode<T extends IndexedDocument>(documents: T[], raw: Record<string, { mdx?: string }>): T[] {
  return documents.map((doc) => {
    const source = raw[doc.route]?.mdx
    const extracted = source ? extractCode(source) : ''
    return extracted ? { ...doc, content: `${doc.content}\n${extracted}` } : doc
  })
}
