import { defineComponents } from 'blume'

// Statically parsed by Blume (never executed) — keep values literal.
export default defineComponents({
  mdx: {
    SponsorSlot: './sponsors/SponsorSlot.astro',
  },
  layout: {
    Sidebar: './components/blume/NavTree.astro',
    MobileNav: './components/blume/MobileNav.astro',
    TableOfContents: './components/blume/TableOfContents.astro',
  },
})
