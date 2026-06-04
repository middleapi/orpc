<script setup lang="ts">
const route = useRoute()

const items = computed(() => [{
  label: 'Base',
  to: '/',
  active: route.path === '/',
}, {
  label: 'Applications',
  to: '/apps',
}])
</script>

<template>
  <UHeader>
    <template #left>
      <NuxtLink to="/">
        <AppLogo />
      </NuxtLink>
    </template>

    <UNavigationMenu :items="items" variant="link" />

    <template #right>
      <UColorModeButton />

      <UButton
        icon="i-lucide-log-in"
        color="neutral"
        variant="ghost"
        to="/login"
        class="lg:hidden"
      />

      <UButton label="Sign in" trailing-icon="i-lucide-log-in" to="/login" class="hidden lg:inline-flex" />
    </template>

    <template #body>
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        class="-mx-2.5"
      />

      <USeparator class="my-6" />

      <UButton label="Sign in" to="/login" block />
    </template>
  </UHeader>
</template>
