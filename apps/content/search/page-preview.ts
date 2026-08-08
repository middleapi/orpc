// The search dialog's preview pane renders `hit.content` — the index's plain
// text — so whatever a result matched on arrives stripped of the structure that
// makes it readable: a code block loses its highlighting, a table its columns, a
// callout its framing.
//
// This replaces that text with the page itself. The blocks around the match are
// lifted out of the target page's HTML and dropped into a `.prose` wrapper, the
// same container the page renders them in, so Shiki highlighting, callouts,
// tables and images all look exactly as they do on the page — pre-rendered at
// build time, with no renderer shipped to the browser. `zoom` shrinks the
// fragment to preview scale without changing how any of it is laid out. Pages
// are fetched once and cached; the fetch doubles as a warm cache for the
// navigation the reader is about to make.
//
// It augments Blume's built-in dialog rather than forking it (747 lines that
// would then need re-merging on every upgrade). Blume rewrites the preview's
// innerHTML on each selection change, so a MutationObserver is the join point,
// and the DOM details borrowed from it — the `data-blume-search-*` hooks, the
// selected row's `bg-muted` class, the text preview being the sibling after the
// title — are all checked, never assumed: if a future version moves them, the
// pane simply keeps Blume's own text preview.

/** Blume's search dialog hooks. */
const PREVIEW = '[data-blume-search-preview]'
const RESULTS = '[data-blume-search-results]'
const INPUT = '[data-blume-search-input]'
/** Blume marks the selected row with this class (ROW_ON in its Search.astro). */
const SELECTED = 'bg-muted'
/** Blume's own text preview: the block it renders after the result title. */
const TEXT_PREVIEW = 'h3 + div'

/** Marks our own subtree so the observer ignores the mutations it causes. */
const OWN = 'data-orpc-page-preview'

/** Wait out a burst of arrow-key selections before spending a fetch. */
const DEBOUNCE = 120
/**
 * Preview scale. Page text is sized for a full column; at ~0.85 the fragment
 * still reads at the pane's width while keeping every proportion the page has.
 */
const ZOOM = '0.85'
/** Blocks of context kept after the match, and how far back a heading is taken. */
const TRAILING = 4
const HEADING_LOOKBACK = 3
/** Parsed articles held at once — enough for a result list, bounded for memory. */
const CACHE_LIMIT = 8

/** Page furniture that is not page content, dropped before anything is scored. */
const CHROME = '[data-sponsor-slot], script, style, .twoslash-popup-container'
/** A heading opens the section a match sits in, so it comes along as context. */
const HEADING = /^h[1-6]$/iu
/** Attributes that would collide with the live page's own copies. */
const IDENTIFIERS = ['id', 'for', 'name'] as const

/** Regex-special characters to escape when a query token becomes a pattern. */
const REGEXP_SPECIAL = /[$()*+.?[\\\]^{|}]/gu
/** Splits an identifier-shaped token into the words Shiki renders separately. */
const NON_WORD = /[^\p{L}\p{N}_]+/gu

/** Parsed articles by URL, oldest first (insertion order backs the eviction). */
const articles = new Map<string, Promise<Element | null>>()

/**
 * Fetch a page and keep its article, stripped of chrome. The sponsor slot goes
 * first of all: it is injected into every docs page, and an ad has no business
 * riding along into a search preview. Twoslash popups go too — their placement
 * script anchors them to the viewport against the page they came from, and
 * inside a modal dialog that puts them in the wrong place, often over the
 * results list.
 */
function loadArticle(url: string): Promise<Element | null> {
  let article = articles.get(url)
  if (!article) {
    article = fetch(url, { headers: { Accept: 'text/html' } })
      .then(response => (response.ok ? response.text() : ''))
      .then((html) => {
        const found = html
          ? new DOMParser().parseFromString(html, 'text/html').querySelector('article')
          : null
        if (!found) {
          return null
        }
        const owned = document.importNode(found, true)
        for (const node of owned.querySelectorAll(CHROME)) {
          node.remove()
        }
        return owned
      })
      // A failed enrichment is not worth surfacing — the pane still shows
      // Blume's text preview. Cache the miss so it isn't retried per keystroke,
      // and let a page reload be what retries it.
      .catch(() => null)

    articles.set(url, article)
    if (articles.size > CACHE_LIMIT) {
      articles.delete(articles.keys().next().value!)
    }
  }
  return article
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
 * The block that best explains the match: most occurrences of the query wins,
 * ties going to the first block on the page. Blume renders an article as a flat
 * run of top-level blocks, so a child here is a whole paragraph, code block,
 * table or callout — the unit a reader recognizes.
 *
 * A page whose blocks match nothing is left to Blume's text preview. That
 * happens when the match is in the title or description, where an arbitrary
 * opening paragraph would be noise rather than an answer.
 */
function bestIndex(nodes: Element[], words: string[]): number {
  const match = pattern(words)
  if (!match) {
    return -1
  }
  let best = -1
  let bestScore = 0
  for (const [index, node] of nodes.entries()) {
    const score = (node.textContent ?? '').match(match)?.length ?? 0
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  }
  return best
}

/**
 * The run of blocks to show: the match, the heading that introduces it, and
 * enough of what follows to read as a passage rather than a clipping. The
 * heading is only taken when it is close by — further back it belongs to
 * something else on the way to the match.
 */
function fragment(nodes: Element[], index: number): Element[] {
  let start = index
  for (let step = 1; step <= HEADING_LOOKBACK && index - step >= 0; step += 1) {
    if (HEADING.test(nodes[index - step]!.tagName)) {
      start = index - step
      break
    }
  }
  return nodes.slice(start, index + 1 + TRAILING)
}

/**
 * Wrap matches in `<mark>` inside the fragment's text nodes, so the reason a
 * block was chosen is visible without reading it line by line. Text nodes are
 * collected before splitting, since splitting one appends siblings the walker
 * would otherwise revisit forever. Returns whether anything was marked.
 */
function markMatches(root: Element, words: string[]): boolean {
  const match = pattern(words, true)
  if (!match) {
    return false
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node as Text)
  }

  let marked = false
  for (const text of texts) {
    const parts = (text.textContent ?? '').split(match)
    if (parts.length < 2) {
      continue
    }
    const replacement = document.createDocumentFragment()
    for (const [index, part] of parts.entries()) {
      if (!part) {
        continue
      }
      if (index % 2 === 1) {
        const mark = document.createElement('mark')
        mark.textContent = part
        replacement.append(mark)
        marked = true
      }
      else {
        replacement.append(part)
      }
    }
    text.replaceWith(replacement)
  }
  return marked
}

/**
 * Highlight the query, falling back to its individual words.
 *
 * Shiki splits a line into one `<span>` per token, so a dotted or dashed query
 * like `os.middleware` spans three text nodes and matches none of them whole —
 * marking `os` and `middleware` separately still points the reader at the right
 * lines. Single characters are dropped from the fallback, since marking every
 * `t` in a code block is noise, not a signal.
 */
function markQuery(root: Element, words: string[]): void {
  if (markMatches(root, words)) {
    return
  }
  const parts = [
    ...new Set(words.flatMap(word => word.split(NON_WORD)).filter(part => part.length > 1)),
  ]
  if (parts.length > 0) {
    markMatches(root, parts)
  }
}

/** Distinguishes one rendered fragment's identifiers from the next one's. */
let renders = 0

/**
 * Namespace the identifiers a fragment carries in. Cloned markup sits in the
 * same document as the page it came from, and a duplicated `id` silently
 * repoints that page's own `label[for]` and anchor targets at the copy inside
 * the dialog. Prefixing keeps them unique without breaking the pairs, so a
 * preview of a tabbed block still switches tabs. In-page links go instead of
 * being rewritten: their targets are on the page behind the dialog, so
 * following one would scroll a page the reader can't see.
 */
function isolate(root: Element): void {
  renders += 1
  const prefix = `orpc-preview-${renders}-`
  for (const attribute of IDENTIFIERS) {
    for (const node of root.querySelectorAll(`[${attribute}]`)) {
      node.setAttribute(attribute, `${prefix}${node.getAttribute(attribute)}`)
    }
  }
  for (const link of root.querySelectorAll('a[href^="#"]')) {
    link.removeAttribute('href')
  }
}

/**
 * Build the fragment as the page renders it. `.prose` is what carries Blume's
 * content styles — including `.prose :where(pre.astro-code)`, which holds the
 * Shiki light/dark variables — so the wrapper reproduces the page's own article
 * element, and `zoom` scales the result down as one piece.
 */
function buildSection(blocks: Element[], words: string[]): HTMLElement {
  const section = document.createElement('div')
  section.setAttribute(OWN, '')
  section.className
    = 'prose max-w-none [&_mark]:rounded-sm [&_mark]:bg-accent/25 [&_mark]:text-inherit'
  section.style.zoom = ZOOM
  section.append(...blocks.map(block => block.cloneNode(true)))

  isolate(section)
  markQuery(section, words)
  return section
}

/** The `<blume-tabs>` API used to switch panels once the element has upgraded. */
interface TabsElement extends Element {
  activate?: (index: number, sync: boolean, updateHash: boolean) => void
}

/**
 * Open the tab holding the match, if it is in one. A tabbed block shows a single
 * panel — the Cloudflare variant of a snippet, one package manager of four — and
 * a match in any other panel renders to zero height, so the fragment would look
 * like it doesn't contain what the reader searched for.
 *
 * An upgraded `<blume-tabs>` is asked to switch, which keeps its trigger row in
 * step (styling the panel directly would leave the tabs stuck, since a later
 * click toggles a class an inline style outranks). Where the element never
 * upgrades — the reader is on a page with no tabs of its own, so the definition
 * was never loaded — Blume's pre-hydration CSS shows the first panel and inline
 * styles are the only way past it. Switching is deliberately not synced: these
 * tabs are a preview of a page, and must not restyle the one behind the dialog.
 */
function revealTab(mark: Element): void {
  const tabs: TabsElement | null = mark.closest('blume-tabs')
  const content = tabs?.querySelector(':scope > [data-blume-tab-content]')
  if (!content) {
    return
  }
  const panels = [...content.children]
  const index = panels.findIndex(panel => panel.contains(mark))
  if (index < 0) {
    return
  }
  if (typeof tabs!.activate === 'function') {
    tabs!.activate(index, false, false)
    return
  }
  for (const [position, panel] of panels.entries()) {
    ;(panel as HTMLElement).style.display = position === index ? 'block' : 'none'
  }
}

/**
 * Bring the first match into view. The pane is the scroller here — the fragment
 * flows at full height inside it, the way the page itself would — so the offset
 * is measured between the two rather than read off `offsetTop`, which would be
 * relative to whichever ancestor happens to be positioned.
 */
function revealMatch(preview: HTMLElement, section: HTMLElement): void {
  // The first mark in document order is the first match, the one markMatches
  // walked to first.
  const mark = section.querySelector('mark')
  if (!mark) {
    return
  }
  // Before measuring: opening a tab changes what sits above the match.
  revealTab(mark)
  const offset
    = mark.getBoundingClientRect().top - preview.getBoundingClientRect().top
  preview.scrollTop += offset - preview.clientHeight / 2
}

const preview = document.querySelector<HTMLElement>(PREVIEW)
const results = document.querySelector<HTMLElement>(RESULTS)
const input = document.querySelector<HTMLInputElement>(INPUT)

if (preview && results && input) {
  // Every selection change supersedes the pending one: the fetch it awaits can
  // land after the reader has arrowed on, and appending then would attach a
  // stale fragment to a different result's preview.
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

    const article = await loadArticle(selected.href)
    if (!article || current !== generation) {
      return
    }
    const blocks = [...article.children]
    const index = bestIndex(blocks, words)
    // Re-checked after the await: Blume may have rewritten the pane while the
    // page was in flight, and a second fragment would stack under the first.
    if (index < 0 || preview!.querySelector(`[${OWN}]`)) {
      return
    }

    const section = buildSection(fragment(blocks, index), words)
    preview!.append(section)
    // Only now that the real thing is on screen: the text preview would
    // otherwise be the fallback vanishing before its replacement arrives.
    preview!.querySelector<HTMLElement>(TEXT_PREVIEW)?.setAttribute('hidden', '')
    revealMatch(preview!, section)
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
