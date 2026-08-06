import { readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORDS_PER_AD = 600
export const SLOT_TAG = '<SponsorSlot />'

/**
 * Pick `n` unique, evenly spaced indices in `[0, total)`.
 * Assumes `n <= total`.
 */
function pickEvenIndices(total: number, n: number): number[] {
  const picked = new Set<number>()
  for (let i = 0; i < n; i++) {
    let idx = Math.min(total - 1, Math.max(0, Math.round(((i + 1) * total) / (n + 1))))
    while (picked.has(idx) && idx < total - 1) idx++
    while (picked.has(idx) && idx > 0) idx--
    picked.add(idx)
  }
  return [...picked].sort((a, b) => a - b)
}

/**
 * Insert `<SponsorSlot />` tags into MDX source: one per ~600 words (code
 * blocks included in the count), min 1, no fixed maximum. The first slot
 * always sits right before the first
 * `##` heading (end of the intro); the rest go after evenly spaced `##`
 * headings — section boundaries, never mid-paragraph — so the total is
 * structurally capped at one per section. Pages without `##` headings get a
 * single slot at the end. Code fences and frontmatter are left untouched.
 */
export function injectSlots(source: string): string {
  const lines = source.split('\n')

  let bodyStart = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end !== -1) {
      bodyStart = end + 1
    }
  }

  let inFence = false
  let words = 0
  const h2Lines: number[] = []
  for (let i = bodyStart; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (!inFence && /^##\s/.test(trimmed)) {
      h2Lines.push(i)
    }
    words += trimmed.split(/\s+/).filter(Boolean).length
  }

  const count = Math.max(1, Math.floor(words / WORDS_PER_AD))

  if (h2Lines.length === 0) {
    lines.push('', SLOT_TAG, '')
    return lines.join('\n')
  }

  // Slots beyond the first go after evenly spaced headings, at most one per
  // section; all their insertion points sit at or below the first heading, so
  // splicing bottom-up keeps every index valid, with the before-intro slot last.
  const remaining = Math.min(count - 1, h2Lines.length)
  const afterLines = remaining > 0
    ? pickEvenIndices(h2Lines.length, remaining).map(idx => h2Lines[idx]!)
    : []
  for (const line of afterLines.sort((a, b) => b - a)) {
    lines.splice(line + 1, 0, '', SLOT_TAG, '')
  }
  lines.splice(h2Lines[0]!, 0, '', SLOT_TAG, '')

  return lines.join('\n')
}

const contentDirs = ['docs', 'blog'].map(
  dir => join(dirname(fileURLToPath(import.meta.url)), '..', dir) + sep,
)

/**
 * Vite plugin that rewrites docs/blog MDX at load time (before Blume's MDX
 * compiler runs), so authored sources on disk stay clean.
 */
export function sponsorAdsInjectPlugin() {
  return {
    name: 'sponsor-ads-inject',
    enforce: 'pre' as const,
    async load(id: string) {
      const path = id.split('?')[0]!
      if (!path.endsWith('.mdx') || !contentDirs.some(dir => path.startsWith(dir))) {
        return null
      }
      return injectSlots(await readFile(path, 'utf-8'))
    },
  }
}
