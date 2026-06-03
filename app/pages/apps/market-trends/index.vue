<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

definePageMeta({
  layout: 'app-market-trends',
  middleware: 'auth',
})

useSeoMeta({
  title: 'Market trends',
})

const UBadge = resolveComponent('UBadge')

const { $orpc } = useNuxtApp()
const queryClient = useQueryClient()
const toast = useToast()

const query = useQuery($orpc.apps.marketTrends.indexes.list.queryOptions())

await query.suspense()

type MarketTrend = NonNullable<typeof query.data.value>[number]

const trends = computed(() => query.data.value ?? [])
const lastFetchedAt = computed(() => latestTimestamp(trends.value.map(trend => trend.fetchedAt)))
const advancingCount = computed(() => trends.value.filter(trend => trend.direction === 'up').length)
const decliningCount = computed(() => trends.value.filter(trend => trend.direction === 'down').length)

const columns: TableColumn<MarketTrend>[] = [{
  accessorKey: 'name',
  header: 'Index',
  cell: ({ row }) => h('div', { class: 'min-w-56' }, [
    h('p', { class: 'font-medium text-highlighted' }, row.original.name),
    h('p', { class: 'text-xs text-muted' }, `${row.original.region} - ${row.original.providerSymbol}`),
  ]),
}, {
  accessorKey: 'price',
  header: 'Last',
  cell: ({ row }) => h('div', { class: 'tabular-nums' }, [
    h('p', { class: 'font-medium text-highlighted' }, formatNumber(row.original.price)),
    h('p', { class: 'text-xs text-muted' }, row.original.currency),
  ]),
}, {
  accessorKey: 'changePercent',
  header: 'Move',
  cell: ({ row }) => h(UBadge, {
    color: getMoveColor(row.original.direction),
    icon: getMoveIcon(row.original.direction),
    label: formatSignedPercent(row.original.changePercent),
    variant: 'subtle',
  }),
}, {
  accessorKey: 'previousClose',
  header: 'Prev. close',
  cell: ({ row }) => h('span', { class: 'tabular-nums text-muted' }, formatNumber(row.original.previousClose)),
}, {
  accessorKey: 'marketTime',
  header: 'Market time',
  cell: ({ row }) => h('span', { class: 'whitespace-nowrap text-muted' }, formatDateTime(row.original.marketTime)),
}, {
  accessorKey: 'fetchedAt',
  header: 'Fetched',
  cell: ({ row }) => h('span', { class: 'whitespace-nowrap text-muted' }, formatDateTime(row.original.fetchedAt)),
}]

const refreshMutation = useMutation($orpc.apps.marketTrends.indexes.refresh.mutationOptions({
  async onSuccess(result) {
    await queryClient.invalidateQueries({
      queryKey: $orpc.apps.marketTrends.indexes.list.key(),
    })

    toast.add({
      title: 'Market trends refreshed',
      description: `${result.updated.length} index(es) updated${result.failed.length ? `, ${result.failed.length} failed` : ''}.`,
      color: result.failed.length ? 'warning' : 'success',
    })
  },
  onError(error) {
    toast.add({
      title: 'Could not refresh market trends',
      description: error.message,
      color: 'error',
    })
  },
}))

const isRefreshing = computed(() => query.isFetching.value || refreshMutation.isPending.value)

function refreshNow() {
  refreshMutation.mutate(undefined)
}

function getMoveColor(direction: MarketTrend['direction']) {
  if (direction === 'up') {
    return 'success'
  }

  if (direction === 'down') {
    return 'error'
  }

  return 'neutral'
}

function getMoveIcon(direction: MarketTrend['direction']) {
  if (direction === 'up') {
    return 'i-lucide-trending-up'
  }

  if (direction === 'down') {
    return 'i-lucide-trending-down'
  }

  return 'i-lucide-minus'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value)
}

function formatSignedPercent(value: number) {
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    signDisplay: 'always',
    style: 'percent',
  }).format(value / 100)

  return formatted === '+0%' ? '0%' : formatted
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function latestTimestamp(values: string[]) {
  return values.reduce<string | undefined>((latest, value) => {
    if (!latest || value > latest) {
      return value
    }

    return latest
  }, undefined)
}
</script>

<template>
  <UDashboardPanel id="market-trends">
    <template #header>
      <UDashboardNavbar title="Market trends">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="isRefreshing"
            @click="refreshNow"
          />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <p class="text-sm text-muted">
            Last fetched {{ lastFetchedAt ? formatDateTime(lastFetchedAt) : 'never' }}
          </p>
        </template>

        <template #right>
          <UBadge color="success" variant="subtle" :label="`${advancingCount} advancing`" />
          <UBadge color="error" variant="subtle" :label="`${decliningCount} declining`" />
          <UBadge color="neutral" variant="subtle" :label="`${trends.length} indexes`" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <div class="overflow-x-auto">
          <UTable
            :data="trends"
            :columns="columns"
            :loading="query.status.value === 'pending'"
            class="min-w-[820px] shrink-0"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default',
              separator: 'h-0'
            }"
          />
        </div>

        <UAlert
          v-if="!trends.length"
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
          title="No market data yet"
          description="Run the refresh action or the Trigger.dev scheduled task to populate the table."
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
