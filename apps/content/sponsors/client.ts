import type { AdSponsor } from './data'
import { adPool } from './data'

function withTracking(href: string): string {
  // mailto: links take no tracking param; synced hrefs may carry their own.
  if (!href.startsWith('http') || href.includes('ref=')) {
    return href
  }
  return `${href}${href.includes('?') ? '&' : '?'}ref=orpc`
}

/**
 * Clone the slot's server-rendered <template> card (its markup and Tailwind
 * classes live in SponsorSlot.astro, which Blume scans) and fill it with the
 * given sponsor.
 */
function buildCard(slot: Element, sponsor: AdSponsor): Element | null {
  const template = slot.querySelector<HTMLTemplateElement>('template[data-sponsor-template]')
  const card = template?.content.firstElementChild?.cloneNode(true) as HTMLAnchorElement | undefined
  if (!card) {
    return null
  }

  card.href = withTracking(sponsor.href)
  const logo = card.querySelector<HTMLImageElement>('[data-sponsor-logo]')
  if (logo) {
    logo.src = sponsor.logo
  }
  const name = card.querySelector('[data-sponsor-name]')
  if (name) {
    name.textContent = sponsor.name
  }
  const desc = card.querySelector('[data-sponsor-desc]')
  if (desc) {
    desc.textContent = sponsor.description
  }
  return card
}

/**
 * Fill every server-rendered sponsor skeleton with a randomly picked sponsor.
 * Runs on each page load (the site is an MPA), so every view gets a fresh
 * pick. Each slot draws independently, with a sponsor's chance being its
 * `weight` as a percentage of the pool's total — so the same ad can appear
 * multiple times on one page.
 */
function fillSlots(): void {
  const slots = document.querySelectorAll('[data-sponsor-slot]')
  if (slots.length === 0) {
    return
  }

  const pool = adPool()
  if (pool.length === 0) {
    slots.forEach(slot => slot.remove())
    return
  }

  const totalWeight = pool.reduce((sum, sponsor) => sum + sponsor.weight, 0)
  const pick = (): AdSponsor => {
    let r = Math.random() * totalWeight
    for (const sponsor of pool) {
      r -= sponsor.weight
      if (r <= 0) {
        return sponsor
      }
    }
    return pool[pool.length - 1]!
  }

  slots.forEach((slot) => {
    const card = buildCard(slot, pick())
    slot.querySelector('[data-sponsor-body]')?.replaceWith(card ?? '')
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fillSlots)
}
else {
  fillSlots()
}
