// The search dialog's preview pane renders `hit.content` — the index's plain
// text — so a result matched on code shows the query as bare, unformatted
// characters, exactly the form a reader scanning for a snippet can't skim.
//
// This appends the real thing: the block is lifted out of the target page's own
// HTML, already highlighted by Shiki at build time, so no highlighter ships to
// the browser and the code looks identical to how it reads on the page. Pages
// are fetched once and cached; the fetch doubles as a warm cache for the
// navigation the reader is about to make.
//
// It augments Blume's built-in dialog rather than forking it (747 lines that
// would then need re-merging on every upgrade). Blume rewrites the preview's
// innerHTML on each selection change, so a MutationObserver is the join point,
// and the two DOM details borrowed from it — the `data-blume-search-*` hooks and
// the selected row's `bg-muted` class — are both checked, never assumed: if a
// future version moves them, the pane simply keeps Blume's own text preview.

/** Blume's search dialog hooks. */
const PREVIEW = '[data-blume-search-preview]'
const RESULTS = '[data-blume-search-results]'
const INPUT = '[data-blume-search-input]'
/** Blume marks the selected row with this class (ROW_ON in its Search.astro). */
const SELECTED = 'bg-muted'

/** Marks our own subtree so the observer ignores the mutations it causes. */
const OWN = 'data-orpc-code-preview'

/** Wait out a burst of arrow-key selections before spending a fetch. */
const DEBOUNCE = 120
/** Beyond this the pane scrolls rather than pushing the text preview away. */
const MAX_HEIGHT = '22rem'
/** Regex-special characters to escape when a query token becomes a pattern. */
const REGEXP_SPECIAL = /[$()*+.?[\\\]^{|}]/gu
/** Splits an identifier-shaped token into the words Shiki renders separately. */
const NON_WORD = /[^\p{L}\p{N}_]+/gu

/** One page's code blocks, detached from the document they were parsed from. */
const blocks = new Map<string, Promise<HTMLPreElement[]>>()

/**
 * Fetch a page and keep only its code blocks, so a browsed session holds a
 * handful of `<pre>` subtrees rather than a parsed Document per result.
 *
 * Twoslash popups are dropped here: their placement script anchors them to the
 * viewport against the page they came from, and inside a modal dialog that puts
 * them in the wrong place — often over the results list. Dropping them at
 * extraction also keeps the cached subtrees small, since a popup carries a
 * fully highlighted type signature of its own.
 */
function loadBlocks(url: string): Promise<HTMLPreElement[]> {
  let page = blocks.get(url)
  if (!page) {
    page = fetch(url, { headers: { Accept: 'text/html' } })
      .then(response => (response.ok ? response.text() : ''))
      .then((html) => {
        if (!html) {
          return []
        }
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        return [...parsed.querySelectorAll('article pre')].map((pre) => {
          const owned = document.importNode(pre, true) as HTMLPreElement
          for (const node of owned.querySelectorAll('.twoslash-popup-container, script')) {
            node.remove()
          }
          return owned
        })
      })
      // A failed enrichment is not worth surfacing — the pane still shows
      // Blume's text preview. Cache the miss so it isn't retried per keystroke,
      // and let a page reload be what retries it.
      .catch(() => [])
    blocks.set(url, page)
  }
  return page
}

/** Escape a literal so it can be spliced into a pattern. */
function escapeToken(token: string): string {
  return token.replaceAll(REGEXP_SPECIAL, String.raw`\$&`)
}

/** Split a query into non-empty tokens. */
function tokens(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean)
}

/** Case-insensitive alternation over `words`, or null when there are none. */
function pattern(words: string[], capture = false): RegExp | null {
  if (words.length === 0) {
    return null
  }
  const body = words.map(escapeToken).join('|')
  return new RegExp(capture ? `(${body})` : body, 'giu')
}

/**
 * The code block that best explains the match: most occurrences of the query
 * wins, ties going to the first block on the page. A block that matches nothing
 * is never shown — an arbitrary snippet would be noise next to a prose preview
 * that does contain the match.
 */
function bestBlock(pres: HTMLPreElement[], words: string[]): HTMLPreElement | null {
  const match = pattern(words)
  if (!match) {
    return null
  }
  let best: HTMLPreElement | null = null
  let bestScore = 0
  for (const pre of pres) {
    const score = (pre.textContent ?? '').match(match)?.length ?? 0
    if (score > bestScore) {
      best = pre
      bestScore = score
    }
  }
  return best
}

/**
 * Wrap matches in `<mark>` inside the block's text nodes, so the reason a block
 * was chosen is visible without reading it line by line. Text nodes are
 * collected before splitting, since splitting one appends siblings the walker
 * would otherwise revisit forever. Returns the first mark, or null if the words
 * never landed inside a single text node.
 */
function markMatches(root: Element, words: string[]): Element | null {
  const match = pattern(words, true)
  if (!match) {
    return null
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node as Text)
  }

  let first: Element | null = null
  for (const text of texts) {
    const parts = (text.textContent ?? '').split(match)
    if (parts.length < 2) {
      continue
    }
    const fragment = document.createDocumentFragment()
    for (const [index, part] of parts.entries()) {
      if (!part) {
        continue
      }
      if (index % 2 === 1) {
        const mark = document.createElement('mark')
        mark.textContent = part
        fragment.append(mark)
        first ??= mark
      }
      else {
        fragment.append(part)
      }
    }
    text.replaceWith(fragment)
  }
  return first
}

/**
 * Highlight the query inside the block, falling back to its individual words.
 *
 * Shiki splits a line into one `<span>` per token, so a dotted or dashed query
 * like `os.middleware` spans three text nodes and matches none of them whole —
 * marking `os` and `middleware` separately still points the reader at the right
 * lines. Single characters are dropped from the fallback, since marking every
 * `t` in a code block is noise, not a signal.
 */
function markQuery(root: Element, words: string[]): Element | null {
  const whole = markMatches(root, words)
  if (whole) {
    return whole
  }
  const parts = [
    ...new Set(words.flatMap(word => word.split(NON_WORD)).filter(part => part.length > 1)),
  ]
  return parts.length > 0 ? markMatches(root, parts) : null
}

/**
 * Build the appended section. The block is wrapped in `.prose` because Blume's
 * code styles (`.prose :where(pre.astro-code)`, which carry the Shiki
 * light/dark variables) only apply inside one.
 */
function buildSection(pre: HTMLPreElement, words: string[]): HTMLElement {
  const clone = pre.cloneNode(true) as HTMLPreElement
  clone.style.margin = '0'
  clone.style.maxHeight = MAX_HEIGHT
  markQuery(clone, words)

  const section = document.createElement('div')
  section.setAttribute(OWN, '')
  section.className
    = 'prose mt-4 [&_mark]:rounded-sm [&_mark]:bg-accent/25 [&_mark]:text-inherit'
  section.append(clone)
  return section
}

/**
 * Bring the first match into view within a block taller than its cap — a match
 * below the fold is invisible, which defeats the point of choosing that block.
 *
 * Runs after the section is in the document, since the offsets it reads are
 * only real once the block has been laid out at its capped height. The `<pre>`'s
 * own scrollTop is set rather than scrollIntoView, which would also scroll the
 * pane and the dialog, jumping the layout under the reader. Theme CSS gives
 * `pre` `position: relative`, making it the offset parent of the mark.
 */
function revealMatch(section: HTMLElement): void {
  const pre = section.querySelector('pre')
  // The first mark in document order is the first match, the one markMatches
  // walked to first.
  const mark = section.querySelector<HTMLElement>('mark')
  if (pre && mark) {
    pre.scrollTop = Math.max(0, mark.offsetTop - pre.clientHeight / 2)
  }
}

const preview = document.querySelector<HTMLElement>(PREVIEW)
const results = document.querySelector<HTMLElement>(RESULTS)
const input = document.querySelector<HTMLInputElement>(INPUT)

if (preview && results && input) {
  // Every selection change supersedes the pending one: the fetch it awaits can
  // land after the reader has arrowed on, and appending then would attach a
  // stale block to a different result's preview.
  let generation = 0
  let timer: number | undefined

  async function enrich(): Promise<void> {
    generation += 1
    const current = generation

    // Blume keeps writing the pane while it is hidden — below `md`, and
    // whenever the reader has toggled the preview off with ⌘J. Neither case
    // should spend a page fetch on markup nobody will see.
    if (preview!.offsetParent === null) {
      return
    }

    const selected = results!.querySelector<HTMLAnchorElement>(`a.${SELECTED}`)
    const words = tokens(input!.value)
    if (!selected || words.length === 0) {
      return
    }

    const pres = await loadBlocks(selected.href)
    if (current !== generation) {
      return
    }
    const pre = bestBlock(pres, words)
    // Re-checked after the await: Blume may have rewritten the pane while the
    // page was in flight, and a second section would stack under the first.
    if (!pre || preview!.querySelector(`[${OWN}]`)) {
      return
    }
    const section = buildSection(pre, words)
    preview!.append(section)
    revealMatch(section)
  }

  const observer = new MutationObserver((records) => {
    // Ignore our own append, which is itself a childList mutation here.
    const ours = records.every(record =>
      [...record.addedNodes].every(
        node => node instanceof Element && node.hasAttribute(OWN),
      ),
    )
    if (ours) {
      return
    }
    generation += 1
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void enrich(), DEBOUNCE)
  })

  observer.observe(preview, { childList: true })
}
