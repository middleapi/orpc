<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'

const { $orpc } = useNuxtApp()

const query = useQuery($orpc.sse.experimental_streamedOptions({
  queryFnOptions: { maxChunks: 3 },
  enabled: import.meta.client,
}))
</script>

<template>
  <div>
    <h2>oRPC and Tanstack Query | Event Iterator example</h2>
    <ClientOnly>
      <pre>
{{ JSON.stringify(query.data.value, null, 2) }}
      </pre>
    </ClientOnly>
  </div>
</template>
