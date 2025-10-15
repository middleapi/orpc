<script lang="ts">
  import { orpc } from '$lib/orpc';
  import { createInfiniteQuery } from '@tanstack/svelte-query';

  const query = createInfiniteQuery(
    () => orpc.planet.list.infiniteOptions({
      input: cursor => ({ cursor, limit: 10 }),
      getNextPageParam: lastPage => lastPage.length === 10 ? lastPage.at(-1)?.id : null,
      initialPageParam: 0,
    })
  );
</script>

{#if query.status === 'pending'}
  <p>Loading...</p>
{:else if query.status === 'success'}
  <div>
    <h2>oRPC and TanStack Query | List Planets example</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Description</th>
          <th>Image</th>
        </tr>
      </thead>
      <tbody>
        {#each query.data.pages as page}
          {#each page as planet}
            <tr>
              <td>{planet.id}</td>
              <td>{planet.name}</td>
              <td>{planet.description}</td>
              <td>{planet.imageUrl}</td>
            </tr>
          {/each}
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4">
            <button
              on:click={() => query.fetchNextPage()}
              disabled={!query.hasNextPage}
            >
              Load more
            </button>
            <button on:click={() => query.refetch()}> Refresh </button>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
{:else}
  <p>Something went wrong.</p>
{/if}
