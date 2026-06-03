import type { NavigationMenuItem } from '@nuxt/ui'

export const marketTrendsNavigation = [{
  label: 'Overview',
  icon: 'i-lucide-trending-up',
  to: '/apps/market-trends',
  exact: true,
}] satisfies NavigationMenuItem[]
