<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'

definePageMeta({
  layout: 'app-lunaria',
  middleware: 'auth',
})

useSeoMeta({
  title: 'Stream',
})

const { $orpc } = useNuxtApp()

const query = useQuery($orpc.apps.lunaria.stream.events.experimental_streamedOptions({
  queryFnOptions: { maxChunks: 3 },
  enabled: false,
}))

onMounted(() => {
  void query.refetch()
})
</script>

<template>
  <UDashboardPanel id="stream">
    <template #header>
      <UDashboardNavbar title="Stream">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="query.isFetching.value"
            @click="() => { void query.refetch() }"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UPageCard title="Event iterator" description="Live output from the app stream endpoint." variant="subtle">
        <ClientOnly>
          <pre class="overflow-auto rounded-md bg-muted p-4 text-sm text-highlighted">{{ JSON.stringify(query.data.value, null, 2) }}</pre>
        </ClientOnly>
      </UPageCard>
    </template>
  </UDashboardPanel>
</template>
