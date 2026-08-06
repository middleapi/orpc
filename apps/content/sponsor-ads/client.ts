import type { AdSponsor } from './data'
import { adPool } from './data'

function withTracking(href: string): string {
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
 * pick; slots on the same page never repeat a sponsor unless the pool is
 * smaller than the slot count.
 */
function fillSlots(): void {
  const slots = document.querySelectorAll('[data-sponsor-slot]')
  if (slots.length === 0) {
    return
  }

  const pool = [...adPool()]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }

  slots.forEach((slot, index) => {
    const card = buildCard(slot, pool[index % pool.length]!)
    slot.querySelector('[data-sponsor-body]')?.replaceWith(card ?? '')
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fillSlots)
}
else {
  fillSlots()
}
