import type { NavigationMenuItem } from '@nuxt/ui'

export const lunariaNavigation = [{
  label: 'Overview',
  icon: 'i-lucide-house',
  to: '/apps/lunaria',
  exact: true
}, {
  label: 'Planets',
  icon: 'i-lucide-orbit',
  to: '/apps/lunaria/planets'
}, {
  label: 'Stream',
  icon: 'i-lucide-radio',
  to: '/apps/lunaria/stream'
}] satisfies NavigationMenuItem[]
