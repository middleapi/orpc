<script setup lang="ts">
import { platformApps } from '~/apps/registry'

definePageMeta({
  layout: 'platform',
  middleware: 'auth'
})

useSeoMeta({
  title: 'Applications',
  description: 'Applications available in Base.'
})
</script>

<template>
  <UDashboardPanel id="applications">
    <template #header>
      <UDashboardNavbar title="Applications">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="API reference"
            icon="i-lucide-book-open"
            color="neutral"
            variant="outline"
            to="/api"
            target="_blank"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UPageGrid>
        <UPageCard
          v-for="app in platformApps"
          :key="app.id"
          :title="app.label"
          :description="app.description"
          :icon="app.icon"
          :to="app.to"
        />
      </UPageGrid>
    </template>
  </UDashboardPanel>
</template>
