<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'

definePageMeta({
  layout: 'app-lunaria',
  middleware: 'auth'
})

useSeoMeta({
  title: 'Planets'
})

const UBadge = resolveComponent('UBadge')

const { $orpc } = useNuxtApp()
const queryClient = useQueryClient()
const toast = useToast()

const createOpen = ref(false)
const form = reactive({
  name: '',
  description: '',
  image: undefined as File | undefined
})

const query = useInfiniteQuery($orpc.apps.lunaria.planets.list.infiniteOptions({
  input: cursor => ({ cursor, limit: 10 }),
  getNextPageParam: lastPage => lastPage.length === 10 ? lastPage.at(-1)?.id : null,
  initialPageParam: 0
}))

await query.suspense()

type Planet = NonNullable<typeof query.data.value>['pages'][number][number]

const planets = computed(() => query.data.value?.pages.flatMap(page => page) ?? [])

const columns: TableColumn<Planet>[] = [{
  accessorKey: 'id',
  header: 'ID',
  cell: ({ row }) => `#${row.original.id}`
}, {
  accessorKey: 'name',
  header: 'Name',
  cell: ({ row }) => h('span', { class: 'font-medium text-highlighted' }, row.original.name)
}, {
  accessorKey: 'description',
  header: 'Description',
  cell: ({ row }) => row.original.description ?? 'No description'
}, {
  accessorKey: 'imageUrl',
  header: 'Image',
  cell: ({ row }) => h(UBadge, {
    color: row.original.imageUrl ? 'success' : 'neutral',
    variant: 'subtle'
  }, () => row.original.imageUrl ? 'Attached' : 'None')
}]

const { mutate, isPending } = useMutation($orpc.apps.lunaria.planets.create.mutationOptions({
  onSuccess() {
    queryClient.invalidateQueries({
      queryKey: $orpc.apps.lunaria.planets.list.key()
    })
    form.name = ''
    form.description = ''
    form.image = undefined
    createOpen.value = false
    toast.add({
      title: 'Planet created',
      description: 'The list will refresh with the new record.',
      color: 'success'
    })
  },
  onError(error) {
    toast.add({
      title: 'Could not create planet',
      description: error.message,
      color: 'error'
    })
  }
}))

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  form.image = input.files?.[0]
}

function onSubmit() {
  mutate({
    name: form.name,
    description: form.description || undefined,
    image: form.image
  })
}
</script>

<template>
  <UDashboardPanel id="planets">
    <template #header>
      <UDashboardNavbar title="Planets">
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

          <UModal v-model:open="createOpen" title="Create planet">
            <UButton label="Create" icon="i-lucide-plus" />

            <template #body>
              <UForm :state="form" class="space-y-4" @submit="onSubmit">
                <UFormField label="Name" name="name" required>
                  <UInput
                    v-model="form.name"
                    class="w-full"
                    placeholder="Earth"
                    required
                  />
                </UFormField>

                <UFormField label="Description" name="description">
                  <UTextarea v-model="form.description" class="w-full" placeholder="A short description" />
                </UFormField>

                <UFormField label="Image" name="image">
                  <UInput
                    type="file"
                    accept="image/*"
                    class="w-full"
                    @change="onFileChange"
                  />
                </UFormField>

                <div class="flex justify-end gap-2">
                  <UButton
                    label="Cancel"
                    color="neutral"
                    variant="ghost"
                    @click="createOpen = false"
                  />
                  <UButton label="Create planet" type="submit" :loading="isPending" />
                </div>
              </UForm>
            </template>
          </UModal>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable
        :data="planets"
        :columns="columns"
        :loading="query.status.value === 'pending'"
        class="shrink-0"
        :ui="{
          base: 'table-fixed border-separate border-spacing-0',
          thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
          tbody: '[&>tr]:last:[&>td]:border-b-0',
          th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
          td: 'border-b border-default',
          separator: 'h-0'
        }"
      />

      <div class="flex items-center justify-between gap-3 border-t border-default pt-4">
        <p class="text-sm text-muted">
          {{ planets.length }} planet(s) loaded.
        </p>

        <UButton
          label="Load more"
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="outline"
          :disabled="!query.hasNextPage.value"
          :loading="query.isFetchingNextPage.value"
          @click="() => { void query.fetchNextPage() }"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
