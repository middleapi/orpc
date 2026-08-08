// The search dialog's preview pane renders `hit.content` — the index's plain
// text — so whatever a result matched on arrives stripped of the structure that
// makes it readable: a code block loses its highlighting, a table its columns, a
// callout its framing.
//
// This replaces that text with the page itself. The whole article is lifted out
// of the target page's HTML and dropped into a `.prose` wrapper, the same
// container the page renders it in, so Shiki highlighting, callouts, tables and
// images all look exactly as they do on the page — pre-rendered at build time,
// with no renderer shipped to the browser. `zoom` shrinks it to preview scale
// without changing how any of it is laid out, and the pane opens scrolled to the
// section the query matched, so a result is a small view of the real page opened
// at the relevant place rather than a clipping of it. Pages are fetched once and
// cached; the fetch doubles as a warm cache for the navigation the reader is
// about to make.
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

/**
 * Wait out a burst of arrow-key selections before spending a fetch on a page
 * that isn't loaded yet. A page already in the cache skips this entirely and
 * renders in the same tick the selection changed, so moving down a result list
 * never shows the text preview flicker past on its way to the real thing.
 */
const DEBOUNCE = 120
/**
 * How far past the selection to fetch ahead. Readers move down a result list, so
 * the next few rows are the ones about to be asked for; fetching them while the
 * reader reads the current one is what makes those selections instant.
 */
const PREFETCH_AHEAD = 3
/**
 * Preview scale. Page text is sized for a full column; at ~0.85 the page still
 * reads at the pane's width while keeping every proportion it has.
 */
const ZOOM = '0.85'
/** How far back from the match a heading is taken as the section's start. */
const HEADING_LOOKBACK = 3
/** Breathing room above the section the pane opens at. */
const SCROLL_PADDING = 12
/** Parsed articles held at once — enough for a result list, bounded for memory. */
const CACHE_LIMIT = 8
/**
 * Rendered pages held at once. Smaller than the article cache: a built page
 * carries the marks and is only useful while the query that made it stands.
 */
const BUILD_LIMIT = 6

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
 * The same articles once they have resolved. Awaiting a settled promise still
 * costs a microtask, and Blume paints its text preview in between — so whether a
 * page can be rendered *now* has to be answerable synchronously.
 */
const ready = new Map<string, Element | null>()

/** A rendered page and where in it the pane should open. */
interface Built {
  section: HTMLElement
  /** Index of the block the query matched, or -1 when the page carries no mark. */
  matched: number
  /** Index of the heading that block sits under, or -1 alongside `matched`. */
  start: number
  /**
   * How far into the page the pane should scroll, in the pane's own pixels.
   * Resolved once while the page is fully laid out — see {@link locate} — and
   * null until then, or for a page with no match, which opens at the top.
   */
  offset: number | null
  /** Whether its blocks have been measured and handed to {@link compact}. */
  measured: boolean
}

/**
 * Let the browser skip the off-screen blocks. A whole docs page laid out in the
 * pane costs tens of milliseconds — far more than cloning and marking it — and
 * that bill comes due every time the page is put back on screen. With
 * `content-visibility` only the visible slice is laid out.
 *
 * The measurement is what makes this safe. `contain-intrinsic-size` is a
 * placeholder for skipped content, and a guessed one would put every block at
 * the wrong offset, landing the opening scroll in the wrong place. Each block is
 * measured after it has been laid out for real, so the placeholder equals the
 * height it replaces and offsets stay exact; `auto` then has the browser prefer
 * the last rendered size over the placeholder as blocks are visited.
 *
 * `offsetHeight`, not `getBoundingClientRect`: the section is zoomed, so the
 * rect is scaled while `contain-intrinsic-size` is in the block's own pixels —
 * the units `offsetHeight` reports.
 */
function compact(built: Built): void {
  if (built.measured) {
    return
  }
  built.measured = true

  // Every height is read before the first style is written. Interleaving them
  // invalidates the layout that the next read then forces again — a page's worth
  // of layouts instead of one, which costs more than this saves.
  const blocks = [...built.section.children] as HTMLElement[]
  const heights = blocks.map(block => block.offsetHeight)
  for (const [index, block] of blocks.entries()) {
    const height = heights[index]!
    if (height > 0) {
      block.style.containIntrinsicSize = `auto ${height}px`
      block.style.contentVisibility = 'auto'
    }
  }
}

/** Rendered pages by page URL and query, oldest first. */
const sections = new Map<string, Built>()

/** Run off the critical path, where the browser has time to spare. */
function whenIdle(work: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(work)
  }
  else {
    setTimeout(work)
  }
}

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
      .then((found) => {
        ready.set(url, found)
        return found
      })

    articles.set(url, article)
    if (articles.size > CACHE_LIMIT) {
      const oldest = articles.keys().next().value!
      articles.delete(oldest)
      ready.delete(oldest)
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

/**
 * Case-insensitive alternation over `words`, or null when there are none. The
 * group is what lets `String.split` hand back the matches along with the text
 * between them, which is how the marking walks a text node in one pass.
 */
function pattern(words: string[]): RegExp | null {
  if (words.length === 0) {
    return null
  }
  return new RegExp(`(${words.map(escapeToken).join('|')})`, 'giu')
}

/**
 * The block that best explains the match: most marks wins, ties going to the
 * first block on the page. Blume renders an article as a flat run of top-level
 * blocks, so a child here is a whole paragraph, code block, table or callout —
 * the unit a reader recognizes.
 *
 * Counting the marks rather than re-scanning the text keeps the section the pane
 * opens at consistent with what is actually highlighted in it, including where
 * only the word-by-word fallback matched, and spares the page a second pass.
 *
 * A page with no marks opens at the top, which is the right place to start
 * reading a page matched on its title alone.
 */
function bestIndex(nodes: Element[]): number {
  let best = -1
  let bestScore = 0
  for (const [index, node] of nodes.entries()) {
    const score = node.querySelectorAll('mark').length
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  }
  return best
}

/**
 * Where to open the page: the heading that introduces the match, so the reader
 * lands on a section rather than mid-sentence. The heading is only taken when it
 * is close by — further back it belongs to something else on the way to the
 * match, and the match itself is then the better anchor.
 */
function sectionStart(nodes: Element[], index: number): number {
  for (let step = 1; step <= HEADING_LOOKBACK && index - step >= 0; step += 1) {
    if (HEADING.test(nodes[index - step]!.tagName)) {
      return index - step
    }
  }
  return index
}

/**
 * Wrap matches in `<mark>` inside the page's text nodes, so the reason a
 * section was chosen is visible without reading it line by line. Text nodes are
 * collected before splitting, since splitting one appends siblings the walker
 * would otherwise revisit forever. Returns whether anything was marked.
 */
function markMatches(root: Element, words: string[]): boolean {
  const match = pattern(words)
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
 * Namespace the identifiers the page carries in. Cloned markup sits in the
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
 * Build the page as it renders itself. `.prose` is what carries Blume's content
 * styles — including `.prose :where(pre.astro-code)`, which holds the Shiki
 * light/dark variables — so the wrapper reproduces the page's own article
 * element, and `zoom` scales the whole thing down as one piece.
 *
 * The cached article is cloned rather than moved: marking matches and
 * namespacing ids both mutate, and the cache has to stay pristine for the next
 * query to mark a different term in the same page.
 */
function buildSection(article: Element, words: string[]): HTMLElement {
  const section = document.createElement('div')
  section.setAttribute(OWN, '')
  section.className
    = 'prose max-w-none [&_mark]:rounded-sm [&_mark]:bg-accent/25 [&_mark]:text-inherit'
  section.style.zoom = ZOOM
  section.append(...[...article.children].map(block => block.cloneNode(true)))

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

/** How far `target`'s top sits below the top of the page it belongs to. */
function offsetWithin(section: HTMLElement, target: Element): number {
  return (
    target.getBoundingClientRect().top - section.getBoundingClientRect().top
  )
}

/**
 * Work out where the pane should open, while the page is still laid out in full.
 *
 * This runs once per built page, before {@link compact} hands the off-screen
 * blocks to the browser to skip — after that their geometry is a placeholder by
 * design, and asking a skipped block where its mark sits gives an answer that
 * would scroll somewhere else entirely. Resolving the offset up front also makes
 * every later showing of the page land in exactly the same place.
 *
 * The section heading is what gets aligned, since landing on it is what tells
 * the reader where in the page they are. When the match itself would then sit
 * below the fold — a long section, or a heading far above its code block — the
 * match wins and is centered instead: the reader came here for it.
 */
function locate(preview: HTMLElement, built: Built): void {
  const heading = built.section.children[built.start]
  if (!heading) {
    return
  }
  // The mark inside the matched block is the one that chose this section.
  const mark = built.section.children[built.matched]?.querySelector('mark')
  // Before measuring: opening a tab changes what sits above the match.
  if (mark) {
    revealTab(mark)
  }

  const offset = offsetWithin(built.section, heading) - SCROLL_PADDING
  const markOffset = mark ? offsetWithin(built.section, mark) : offset
  built.offset
    = markOffset - offset > preview.clientHeight
      ? markOffset - preview.clientHeight / 2
      : offset
}

/** Scroll the pane to the offset {@link locate} settled on. */
function openAt(preview: HTMLElement, built: Built): void {
  if (built.offset === null) {
    return
  }
  const top
    = built.section.getBoundingClientRect().top
      - preview.getBoundingClientRect().top
      + preview.scrollTop
  preview.scrollTop = top + built.offset
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

  /** Result rows, in the order they are listed. */
  function rows(): HTMLAnchorElement[] {
    return [...results!.querySelectorAll<HTMLAnchorElement>('a')]
  }

  /**
   * The rendered page for a row, built once per page and query. Cloning a whole
   * article and marking it costs tens of milliseconds, and a reader walking a
   * result list revisits the same rows constantly — rebuilding each time is what
   * a hover would feel. The built node is detached when Blume clears the pane
   * and re-appended on the next visit, which is free.
   */
  function sectionFor(url: string, article: Element, words: string[]): Built {
    const key = `${url}\n${words.join(' ')}`
    const cached = sections.get(key)
    if (cached) {
      return cached
    }

    const section = buildSection(article, words)
    const blocks = [...section.children]
    const matched = bestIndex(blocks)
    const built: Built = {
      matched,
      measured: false,
      offset: null,
      section,
      start: matched < 0 ? -1 : sectionStart(blocks, matched),
    }

    sections.set(key, built)
    if (sections.size > BUILD_LIMIT) {
      sections.delete(sections.keys().next().value!)
    }
    return built
  }

  /** Render the selected row's page, or leave Blume's text preview in place. */
  function render(url: string, article: Element | null, words: string[]): void {
    // Re-checked here rather than by the caller: on the awaited path Blume may
    // have rewritten the pane while the page was in flight, and a second copy
    // would stack under the first.
    if (!article || preview!.querySelector(`[${OWN}]`)) {
      return
    }

    const built = sectionFor(url, article, words)
    preview!.append(built.section)
    // Only now that the real thing is on screen: the text preview would
    // otherwise be the fallback vanishing before its replacement arrives.
    preview!.querySelector<HTMLElement>(TEXT_PREVIEW)?.setAttribute('hidden', '')

    // First showing only: settle where to open and hand the rest of the page to
    // the browser to skip. Both need the full layout that appending just forced,
    // so they cost nothing extra here and spare every later showing.
    if (!built.measured) {
      if (built.matched >= 0) {
        locate(preview!, built)
      }
      compact(built)
    }
    // Every showing: Blume gave the pane a fresh scroll position when it rewrote
    // it, so the page has to be scrolled back down to its section.
    openAt(preview!, built)
  }

  /**
   * Warm the rows just past the selection: fetch their pages, then build them
   * while the reader is still reading the current one, so arriving costs an
   * append. `loadArticle` and `sectionFor` both dedupe, so this is a no-op once
   * a result list has been walked, and repeating it per selection keeps the
   * window sliding with the reader rather than doing the whole list up front —
   * most of which is never previewed.
   *
   * Building is deferred to idle time. It is the expensive half, and nothing is
   * waiting on it: a row reached before its build finishes just builds on
   * arrival, exactly as it did before.
   */
  function prefetch(selected: HTMLAnchorElement, words: string[]): void {
    const listed = rows()
    const from = listed.indexOf(selected) + 1
    for (const row of listed.slice(from, from + PREFETCH_AHEAD)) {
      const url = row.href
      void loadArticle(url).then((article) => {
        if (article) {
          whenIdle(() => sectionFor(url, article, words))
        }
      })
    }
  }

  function enrich(): void {
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
    prefetch(selected, words)
    const url = selected.href

    // Already loaded: render in this tick, so the page is on screen in the same
    // frame Blume wrote its text preview and the reader never sees the
    // placeholder it replaces.
    if (ready.has(url)) {
      render(url, ready.get(url)!, words)
      return
    }

    void loadArticle(url).then((article) => {
      if (current === generation) {
        render(url, article, words)
      }
    })
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
    // A cached page is rendered straight away; only a fetch is worth waiting to
    // see whether the reader settles on this row first.
    const selected = results!.querySelector<HTMLAnchorElement>(`a.${SELECTED}`)
    if (selected && ready.has(selected.href)) {
      enrich()
    }
    else {
      timer = window.setTimeout(enrich, DEBOUNCE)
    }
  })

  observer.observe(preview, { childList: true })
}
