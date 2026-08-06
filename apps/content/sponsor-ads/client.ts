import type { AdSponsor } from './data'
import { adPool } from './data'

function withTracking(href: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}ref=orpc`
}

function buildCard(sponsor: AdSponsor): HTMLAnchorElement {
  const link = document.createElement('a')
  link.className = 'sponsor-slot__body'
  link.href = withTracking(sponsor.href)
  link.target = '_blank'
  link.rel = 'sponsored noopener'

  const logo = document.createElement('img')
  logo.className = 'sponsor-slot__logo'
  logo.src = sponsor.logo
  logo.alt = ''
  logo.loading = 'lazy'
  logo.setAttribute('data-no-zoom', '')

  const text = document.createElement('span')
  text.className = 'sponsor-slot__text'
  const name = document.createElement('span')
  name.className = 'sponsor-slot__name'
  name.textContent = sponsor.name
  const desc = document.createElement('span')
  desc.className = 'sponsor-slot__desc'
  desc.textContent = sponsor.description
  text.append(name, desc)

  link.append(logo, text)
  return link
}

/**
 * Fill every server-rendered sponsor skeleton with a randomly picked sponsor.
 * Runs on each page load (the site is an MPA), so every view gets a fresh
 * pick; slots on the same page never repeat a sponsor unless the pool is
 * smaller than the slot count.
 */
function fillSlots(): void {
  const bodies = document.querySelectorAll('[data-sponsor-body]')
  if (bodies.length === 0) {
    return
  }

  const pool = [...adPool()]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }

  bodies.forEach((body, index) => {
    body.replaceWith(buildCard(pool[index % pool.length]!))
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fillSlots)
}
else {
  fillSlots()
}
