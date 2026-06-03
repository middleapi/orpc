<script setup lang="ts">
import { lunariaNavigation } from '~/apps/lunaria/navigation'
</script>

<template>
  <AppWorkspaceLayout
    storage-key="app-lunaria"
    sidebar-id="app-lunaria"
    home-to="/apps/lunaria"
    label="Lunaria"
    icon="i-lucide-orbit"
    :navigation="lunariaNavigation"
  >
    <slot />
  </AppWorkspaceLayout>
</template>
