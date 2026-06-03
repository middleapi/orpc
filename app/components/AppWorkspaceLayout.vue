<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/utils/auth-client'

const props = defineProps<{
  storageKey: string
  sidebarId: string
  homeTo: string
  label: string
  icon: string
  navigation: NavigationMenuItem[]
}>()

const open = ref(false)
const session = await authClient.useSession(useFetch)

const user = computed(() => session.data.value?.user)

const links = computed<NavigationMenuItem[]>(() => props.navigation.map(item => ({
  ...item,
  onSelect: () => {
    open.value = false
  },
})))

const resourceLinks = computed<NavigationMenuItem[]>(() => [{
  label: 'All apps',
  icon: 'i-lucide-grid-3x3',
  to: '/apps',
}, {
  label: 'API reference',
  icon: 'i-lucide-book-open',
  to: '/api',
  target: '_blank',
}])

function toSearchItems(items: NavigationMenuItem[]): CommandPaletteItem[] {
  return items.map(item => ({
    label: String(item.label ?? ''),
    icon: item.icon,
    to: item.to,
    target: item.target,
  }))
}

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [{
  id: props.sidebarId,
  label: props.label,
  items: toSearchItems(links.value),
}, {
  id: 'resources',
  label: 'Resources',
  items: toSearchItems(resourceLinks.value),
}])

const userMenuItems = computed<DropdownMenuItem[][]>(() => [[{
  type: 'label',
  label: user.value?.name ?? 'Account',
  avatar: {
    src: user.value?.image ?? undefined,
    alt: user.value?.name ?? 'Account',
  },
}], [{
  label: 'All apps',
  icon: 'i-lucide-grid-3x3',
  to: '/apps',
}, {
  label: 'API reference',
  icon: 'i-lucide-book-open',
  to: '/api',
  target: '_blank',
}], [{
  label: 'Log out',
  icon: 'i-lucide-log-out',
  onSelect: async () => {
    await authClient.signOut()
    await navigateTo('/login')
  },
}]])
</script>

<template>
  <UDashboardGroup :storage-key="props.storageKey" unit="rem">
    <UDashboardSidebar
      :id="props.sidebarId"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          :to="props.homeTo"
          class="flex min-w-0 items-center gap-2 px-2 py-1.5"
          :class="collapsed ? 'justify-center' : ''"
        >
          <div class="flex size-8 items-center justify-center rounded-md bg-primary text-inverted">
            <UIcon :name="props.icon" class="size-5" />
          </div>
          <span v-if="!collapsed" class="truncate text-sm font-semibold text-highlighted">{{ props.label }}</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links"
          orientation="vertical"
          tooltip
          popover
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="resourceLinks"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <ClientOnly>
          <UDropdownMenu
            :items="userMenuItems"
            :content="{ align: 'center', collisionPadding: 12 }"
            :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
          >
            <UButton
              :label="collapsed ? undefined : user?.name"
              :avatar="{ src: user?.image ?? undefined, alt: user?.name ?? 'Account' }"
              :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
              color="neutral"
              variant="ghost"
              block
              :square="collapsed"
              class="data-[state=open]:bg-elevated"
              :ui="{ trailingIcon: 'text-dimmed' }"
            />
          </UDropdownMenu>
        </ClientOnly>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />
  </UDashboardGroup>
</template>
