import { client, orpc } from '../lib/orpc'
import { useQuery } from '@tanstack/react-query'

export function ChatRoomV2() {
  const query = useQuery(
    orpc.messageV2.on.experimental_streamedOptions({
      context: {
        retry: Number.POSITIVE_INFINITY,
      },
    }),
  )

  const sendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const form = new FormData(e.target as HTMLFormElement)
    const message = form.get('message') as string

    await client.messageV2.send({ message })
  }

  return (
    <div>
      <h1>Chat Room with Publisher Helper</h1>
      <p>Open multiple tabs to chat together</p>
      <ul>
        {query.status === 'pending' && <li>Joining...</li>}
        {query.status === 'error' && (
          <li>
            Error while joining
            {String(query.error)}
          </li>
        )}
        {query.status === 'success' && query.data.map(({ message }, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
      <form onSubmit={sendMessage}>
        <input name="message" type="text" required defaultValue="hello" />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
