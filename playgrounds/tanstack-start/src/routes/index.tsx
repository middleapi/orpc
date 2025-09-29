import { createFileRoute } from '@tanstack/react-router'
import { CreatePlanetMutationForm } from '~/components/orpc-mutation'
import { ListPlanetsQuery } from '~/components/orpc-query'
import { EventIteratorQueries } from '~/components/orpc-stream'

export const Route = createFileRoute('/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div>
      <h1>ORPC Playground</h1>
      You can visit the
      {' '}
      <a href="/api">Redirect to Scalar API Reference</a>
      {' '}
      page.
      <hr />
      <CreatePlanetMutationForm />
      <hr />
      <ListPlanetsQuery />
      <hr />
      <EventIteratorQueries />
    </div>
  )
}
