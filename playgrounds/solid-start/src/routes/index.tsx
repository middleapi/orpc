import { CreatePlanetMutationForm } from './orpc-mutation'
import { ListPlanetsQuery } from './orpc-query'
import { EventIteratorQueries } from './orpc-stream'

export default function Home() {
  return (
    <main>
      <h1>ORPC Playground</h1>
      <p>
        You can visit the
        {' '}
        <a href="/api">Scalar API Reference</a>
        {' '}
        page.
      </p>
      <hr />
      <CreatePlanetMutationForm />
      <hr />
      <ListPlanetsQuery />
      <hr />
      <EventIteratorQueries />
    </main>
  )
}
