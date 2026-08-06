import { readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORDS_PER_AD = 150
export const SLOT_TAG = '<SponsorSlot />'

/**
 * Insert `<SponsorSlot />` tags into MDX source. One simple rule: walk the
 * page accumulating words (code blocks count; fences are tracked only so a
 * `##` inside one is ignored), and place a slot right before a `##` heading
 * whenever it is the page's first heading or at least `WORDS_PER_AD` words
 * have passed since the last slot, resetting the count. If the trailing
 * content also clears the bar — or the page never triggered at all — one
 * more slot goes at the end. Frontmatter is left untouched.
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
  let seenH2 = false
  let words = 0
  const insertBefore: number[] = []
  for (let i = bodyStart; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
    }
    else if (!inFence && /^##\s/.test(trimmed) && (!seenH2 || words >= WORDS_PER_AD)) {
      seenH2 = true
      insertBefore.push(i)
      words = 0
    }
    words += trimmed === '' ? 0 : trimmed.split(/\s+/).length
  }

  // Splice bottom-up so earlier indices stay valid.
  for (const line of insertBefore.reverse()) {
    lines.splice(line, 0, '', SLOT_TAG, '')
  }
  if (insertBefore.length === 0 || words >= WORDS_PER_AD) {
    lines.push('', SLOT_TAG, '')
  }

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
    name: 'sponsors-inject',
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
