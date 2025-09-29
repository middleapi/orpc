import { orpc } from '@renderer/lib/orpc'
import { useQuery } from '@tanstack/react-query'

export function EventIteratorQueries() {
  const streamed = useQuery(orpc.sse.experimental_streamedOptions({ queryFnOptions: { maxChunks: 3 } }))

  return (
    <div>
      <h2>oRPC and Tanstack Query | Event Iterator example</h2>
      <pre>
        {JSON.stringify(streamed.data, null, 2)}
      </pre>
    </div>
  )
}
