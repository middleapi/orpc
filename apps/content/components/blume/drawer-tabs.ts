/**
 * Blume's built-in drawer section lists (RootLayout's on docs pages,
 * PageLayout's on chrome-only pages) render every header tab as a plain link
 * to `tab.href ?? tab.path`. A dropdown tab has no page of its own: the "More"
 * tab's `path: ''` makes Blume resolve its href to the first route in the
 * sidebar, so the list linked "More" to an unrelated blog post.
 *
 * theme.css hides both lists (SectionsNav renders the drawer sections instead,
 * expanding "More" into its items), but hidden links stay in the DOM, where
 * Lighthouse's `link-text` audit still flags "More" as non-descriptive. So
 * dropdown tabs are dropped from those lists at load time, before Astro
 * compiles the layouts.
 */

import { readFile } from 'node:fs/promises'

/** The Blume layouts that carry a built-in drawer section list. */
const LAYOUT = /[\\/]blume[\\/]src[\\/]components[\\/]layout[\\/](?:Root|Page)Layout\.astro$/u
/** The list's loop, the only one over `navigation.tabs` in either layout. */
const TABS_LOOP = '{navigation.tabs.map((tab) => ('

/**
 * Vite plugin that removes dropdown tabs (`items`) from the built-in drawer
 * section lists. Fails the build when the loop is not found, so a Blume
 * upgrade that changes the layouts gets this patch re-checked.
 */
export function drawerTabsPlugin() {
  return {
    name: 'drawer-tabs',
    enforce: 'pre' as const,
    async load(id: string) {
      if (!LAYOUT.test(id)) {
        return null
      }

      const source = await readFile(id, 'utf-8')
      if (source.split(TABS_LOOP).length !== 2) {
        throw new Error(`drawer-tabs: expected exactly one \`${TABS_LOOP}\` in ${id}; Blume's layout changed, re-check whether this patch is still needed`)
      }

      return source.replace(TABS_LOOP, '{navigation.tabs.filter((tab) => !tab.items?.length).map((tab) => (')
    },
  }
}
