import { CreatePlanetMutationForm } from './components/orpc-mutation'
import { ListPlanetsQuery } from './components/orpc-query'
import { EventIteratorQueries } from './components/orpc-stream'

export default function App() {
  return (
    <div>
      <h1>ORPC Playground</h1>
      <hr />
      <CreatePlanetMutationForm />
      <hr />
      <ListPlanetsQuery />
      <hr />
      <EventIteratorQueries />
    </div>
  )
}
