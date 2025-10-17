<script lang="ts">
  import { orpc } from '$lib/orpc';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';

  const queryClient = useQueryClient();

  const mutation = createMutation(
    () => orpc.planet.create.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({
          queryKey: orpc.planet.key(),
        });
      },
      onError(error) {
        console.error(error);
        alert(error.message);
      },
    })
  );

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();

    const form = new FormData(e.target as HTMLFormElement);

    const name = form.get('name') as string;
    const description = (form.get('description') as string | null) ?? undefined;
    const image = form.get('image') as File;

    mutation.mutate({
      name,
      description,
      image: image.size > 0 ? image : undefined,
    });
  }
</script>

<div>
  <h2>oRPC and Tanstack Query | Create Planet example</h2>

  <form on:submit={onsubmit}>
    <label>
      Name
      <input type="text" name="name" required />
    </label>
    <label>
      Description
      <textarea name="description"></textarea>
    </label>
    <label>
      Image
      <input type="file" name="image" accept="image/*" />
    </label>
    <button type="submit">Submit</button>
  </form>
</div>
