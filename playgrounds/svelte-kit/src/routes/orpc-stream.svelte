<script lang="ts">
  import { orpc } from '$lib/orpc';
  import { createQuery } from '@tanstack/svelte-query';

  const streamed = createQuery(
    orpc.sse.experimental_streamedOptions({
      queryFnOptions: { maxChunks: 3 }
    })
  );

</script>

<div>
  <h2>oRPC and Tanstack Query | Event Iterator example</h2>
  <pre>
{JSON.stringify($streamed.data, null, 2)}
  </pre>
</div>  