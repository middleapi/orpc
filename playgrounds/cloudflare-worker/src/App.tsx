import { ChatRoom } from './components/chat-room'
import { CreatePlanetMutationForm } from './components/orpc-mutation'
import { ListPlanetsQuery } from './components/orpc-query'
import '@scalar/api-reference-react/style.css'
import { ApiReferenceReact } from '@scalar/api-reference-react'
import { EventIteratorQueries } from './components/orpc-stream'

export default function App() {
  if (location.pathname === '/api') {
    return (
      <ApiReferenceReact
        configuration={{
          url: '/api/spec.json',
        }}
      />
    )
  }

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
      <ChatRoom />
      <hr />
      <EventIteratorQueries />
    </main>
  )
}
