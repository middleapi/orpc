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
 * URLs), which is where the fences come from — no second content pass.
 *
 * The rewritten module imports `blume:raw-markdown` and folds the code in when it
 * evaluates (`code-fold.ts`), rather than baking it in here: that import is what
 * tells Vite the index depends on the Markdown, so editing only a code block in
 * `blume dev` — which changes the Markdown but not Blume's code-free index —
 * still refreshes search.
 *
 * Working on the generated module rather than a fork of Blume's document builder
 * keeps this to one hook: the index keeps its shape, and Orama, FlexSearch, the
 * preview pane and the hosted syncs all read the enriched `content` unchanged.
 */

import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { stringifyJSON } from '@orpc/shared'

/** The resolved id of the virtual module this plugin rewrites (Rollup's `\0` prefix). */
const SEARCH_INDEX_ID = '\0blume:search-index'

/** How Blume's generated module exposes the index. */
const DEFAULT_EXPORT = 'export default '

/** The runtime half, imported by absolute path from the rewritten module. */
const CODE_FOLD = fileURLToPath(new URL('./code-fold.ts', import.meta.url)).replaceAll('\\', '/')

export function searchCodeIndexPlugin(): Plugin {
  return {
    name: 'orpc:search-code-index',
    transform(code, id) {
      if (id !== SEARCH_INDEX_ID) {
        return null
      }

      if (!code.startsWith(DEFAULT_EXPORT)) {
        // Fail loudly: skipping would silently drop code from search.
        this.error('Blume\'s blume:search-index module no longer starts with a default export; update search/code-index.ts for this Blume version.')
      }

      return {
        code: [
          'import raw from "blume:raw-markdown";',
          `import { withCode } from ${stringifyJSON(CODE_FOLD)};`,
          `const index = ${code.slice(DEFAULT_EXPORT.length)}`,
          'export default withCode(index, raw);',
          '',
        ].join('\n'),
        map: null,
      }
    },
  }
}
