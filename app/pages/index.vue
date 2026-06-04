<script setup lang="ts">
import { platformApps } from '~/apps/registry'

const productName = 'Base'

useSeoMeta({
  title: productName,
  description: 'A personal platform for opening and running my applications.',
})

const heroLinks = [{
  label: 'Open applications',
  to: '/apps',
  icon: 'i-lucide-layout-dashboard',
  trailing: true,
}, {
  label: 'API reference',
  to: '/api',
  target: '_blank',
  icon: 'i-lucide-book-open',
  color: 'neutral' as const,
  variant: 'subtle' as const,
}]

const applications = platformApps.map((app) => {
  if (app.id === 'lunaria') {
    return {
      ...app,
      headline: 'Records and streams',
      summary: 'Planet records, creation forms, and live stream endpoint experiments.',
      metric: 'Planets, forms, stream',
    }
  }

  return {
    ...app,
    headline: 'Market snapshots',
    summary: 'Global index snapshots, manual refreshes, and scheduled market-data ingestion.',
    metric: 'Indexes, refreshes, schedule',
  }
})
</script>

<template>
  <div>
    <UPageHero
      :title="productName"
      description="My base for opening, running, and maintaining the applications I use."
      :links="heroLinks"
      :ui="{
        container: 'py-10 sm:py-12 lg:py-14',
        title: 'text-4xl sm:text-5xl lg:text-6xl',
        description: 'text-base sm:text-lg/7',
        footer: 'mt-6'
      }"
    />

    <UPageSection
      headline="Applications"
      title="The tools in Base"
      description="Each app has its own pages, data, and API surface, but they all live behind the same sign-in."
      :ui="{
        container: 'py-8 sm:py-10 lg:py-10',
        title: 'text-3xl sm:text-4xl',
        description: 'text-base',
        body: 'mt-6 sm:mt-8'
      }"
    >
      <UPageGrid>
        <UPageCard
          v-for="app in applications"
          :key="app.id"
          :title="app.label"
          :description="app.summary"
          :icon="app.icon"
          spotlight
        >
          <template #header>
            <UBadge color="neutral" variant="subtle" :label="app.headline" />
          </template>

          <template #footer>
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-muted">{{ app.metric }}</span>
              <UButton
                label="Open"
                color="neutral"
                variant="ghost"
                trailing-icon="i-lucide-arrow-right"
                :to="app.to"
              />
            </div>
          </template>
        </UPageCard>
      </UPageGrid>
    </UPageSection>
  </div>
</template>
