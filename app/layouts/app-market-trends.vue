<script setup lang="ts">
import { marketTrendsNavigation } from '~/apps/market-trends/navigation'
</script>

<template>
  <AppBaseLayout
    storage-key="app-market-trends"
    sidebar-id="app-market-trends"
    home-to="/apps/market-trends"
    label="Market trends"
    icon="i-lucide-trending-up"
    :navigation="marketTrendsNavigation"
  >
    <slot />
  </AppBaseLayout>
</template>
