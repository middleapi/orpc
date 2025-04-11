'use client'

import { orpc } from '@/lib/orpc'
import { useInfiniteQuery } from '@tanstack/react-query'

export function ListPlanetsQuery() {
  const { data, refetch, fetchNextPage, hasNextPage, status } = useInfiniteQuery(
    orpc.planet.list.infiniteOptions({
      input: cursor => ({ cursor, limit: 10 }),
      getNextPageParam: lastPage => lastPage.length === 10 ? lastPage.at(-1)?.id : null,
      initialPageParam: 0,
    }),
  )

  if (status === 'pending') {
    return <p>Loading...</p>
  }

  if (status === 'error') {
    return (
      <p>
        Something went wrong.
      </p>
    )
  }

  return (
    <div>
      <h2>oRPC and Tanstack Query | List Planets example</h2>

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
          {data.pages.flatMap((page, i) =>
            page.map(planet => (
              <tr key={`${planet.id}-${i}`}>
                <td>{planet.id}</td>
                <td>{planet.name}</td>
                <td>{planet.description}</td>
                <td>{planet.imageUrl}</td>
              </tr>
            )),
          )}
        </tbody>

        <tfoot>
          <tr>
            <td colSpan={4}>
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={!hasNextPage}
              >
                Load more
              </button>

              <button type="button" onClick={() => refetch()}>
                Refresh
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

  )
}
