import { useQuery } from '@tanstack/react-query'
import { orpc } from '../lib/orpc'
import { queryClient } from '../shared/query'

export function EventIteratorQueries() {
  const streamed = useQuery(orpc.sse.experimental_streamedOptions({ queryFnOptions: { maxChunks: 3 } }), queryClient)

  return (
    <div>
      <h2>oRPC and Tanstack Query | Event Iterator example</h2>
      <pre>
        {JSON.stringify(streamed.data, null, 2)}
      </pre>
    </div>
  )
}
