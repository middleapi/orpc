import { useQuery } from '@tanstack/solid-query'
import { orpc } from '~/lib/orpc'

export function EventIteratorQueries() {
  const streamed = useQuery(
    () => orpc.sse.experimental_streamedOptions({ queryFnOptions: { maxChunks: 3 } }),
  )

  return (
    <div>
      <h2>oRPC and Tanstack Query | Event Iterator example</h2>
      <pre>
        {JSON.stringify(streamed.data, null, 2)}
      </pre>
    </div>
  )
}
