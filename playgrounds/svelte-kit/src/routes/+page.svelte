<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import OrpcMutation from './orpc-mutation.svelte';
  import OrpcQuery from './orpc-query.svelte';
  import OrpcStream from './orpc-stream.svelte';

  const queryClient = new QueryClient();
</script>

<QueryClientProvider client={queryClient}>
  <div>
    <h1>ORPC Playground</h1>
    <p>
      You can visit the
      {' '}
      <a href="/api">Scalar API Reference</a>
      {' '}
      page.
    </p>
    <hr />
    <OrpcMutation />
    <hr />
    <OrpcQuery />
    <hr />
    <OrpcStream />
  </div>
</QueryClientProvider>
