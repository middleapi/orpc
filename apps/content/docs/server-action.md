---
title: Server Action
description: Integrate oRPC procedures with React Server Actions
---

# Server Action

React [Server Actions](https://react.dev/reference/rsc/server-functions) let client components invoke asynchronous server functions. With oRPC, you simply append the `.actionable` modifier to enable Server Action compatibility.

## Server Side

Define your procedure with `.actionable` for Server Action support.

```ts twoslash
import { onError, onSuccess, os } from '@orpc/server'
import * as z from 'zod'
// ---cut---
'use server'

import { redirect } from 'next/navigation'

export const ping = os
  .input(z.object({ name: z.string() }))
  .handler(async ({ input }) => `Hello, ${input.name}`)
  .actionable({
    context: async () => ({}), // Optional: provide initial context if needed
    interceptors: [
      onSuccess(async output => redirect(`/some-where`)),
      onError(async error => console.error(error)),
    ],
  })
```

:::tip
We recommend using [Runtime Context](/docs/context#execution-context) instead of [Initial Context](/docs/context#initial-context) when working with Server Actions.
:::

:::warning
Special errors such as `redirect`, `notFound`, and similar are **only supported in [Next.js](https://nextjs.org/) and [TanStack Start](https://tanstack.com/start/latest)** at the moment.
:::

## Client Side

On the client, import and call your procedure as follows:

```tsx
'use client'

import { ping } from './actions'

export function MyComponent() {
  const [name, setName] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const [error, data] = await ping({ name })
    console.log(error, data)
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={e => setName(e.target.value)} />
      <button type="submit">Submit</button>
    </form>
  )
}
```

This approach seamlessly integrates server-side procedures with client components via Server Actions.

## Type‑Safe Error Handling

The `.actionable` modifier supports type-safe error handling with a JSON-like error object.

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

export const someAction = os
  .input(z.object({ name: z.string() }))
  .errors({
    SOME_ERROR: {
      message: 'Some error message',
      data: z.object({ some: z.string() }),
    },
  })
  .handler(async ({ input }) => `Hello, ${input.name}`)
  .actionable()
// ---cut---
'use client'

const [error, data] = await someAction({ name: 'John' })

if (error) {
  if (error.defined) {
    console.log(error.data)
    //                 ^ Typed error data
  }
  // Handle unknown errors
}
else {
  // Handle success
  console.log(data)
}
```

## `@orpc/react` Package

The `@orpc/react` package offers utilities to integrate oRPC with React and React Server Actions.

### Installation

::: code-group

```sh [npm]
npm install @orpc/react@latest
```

```sh [yarn]
yarn add @orpc/react@latest
```

```sh [pnpm]
pnpm add @orpc/react@latest
```

```sh [bun]
bun add @orpc/react@latest
```

```sh [deno]
deno add npm:@orpc/react@latest
```

:::

### `useServerAction` Hook

The `useServerAction` hook simplifies invoking server actions in React.

```tsx twoslash
import * as React from 'react'
import { os } from '@orpc/server'
import * as z from 'zod'

export const someAction = os
  .input(z.object({ name: z.string() }))
  .errors({
    SOME_ERROR: {
      message: 'Some error message',
      data: z.object({ some: z.string() }),
    },
  })
  .handler(async ({ input }) => `Hello, ${input.name}`)
  .actionable()
// ---cut---
'use client'

import { useServerAction } from '@orpc/react/hooks'
import { isDefinedError, onError } from '@orpc/client'

export function MyComponent() {
  const { execute, data, error, status } = useServerAction(someAction, {
    interceptors: [
      onError((error) => {
        if (isDefinedError(error)) {
          console.error(error.data)
          //                   ^ Typed error data
        }
      }),
    ],
  })

  const action = async (form: FormData) => {
    const name = form.get('name') as string
    execute({ name })
  }

  return (
    <form action={action}>
      <input type="text" name="name" required />
      <button type="submit">Submit</button>
      {status === 'pending' && <p>Loading...</p>}
    </form>
  )
}
```

### `useOptimisticServerAction` Hook

The `useOptimisticServerAction` hook enables optimistic UI updates while a server action executes. This provides immediate visual feedback to users before the server responds.

```tsx
import { useOptimisticServerAction } from '@orpc/react/hooks'
import { onSuccessDeferred } from '@orpc/react'

export function MyComponent() {
  const [todos, setTodos] = useState<Todo[]>([])
  const { execute, optimisticState } = useOptimisticServerAction(someAction, {
    optimisticPassthrough: todos,
    optimisticReducer: (currentState, newTodo) => [...currentState, newTodo],
    interceptors: [
      onSuccessDeferred(({ data }) => {
        setTodos(prevTodos => [...prevTodos, data])
      }),
    ],
  })

  const handleSubmit = (form: FormData) => {
    const todo = form.get('todo') as string
    execute({ todo })
  }

  return (
    <div>
      <ul>
        {optimisticState.map(todo => (
          <li key={todo.todo}>{todo.todo}</li>
        ))}
      </ul>
      <form action={handleSubmit}>
        <input type="text" name="todo" required />
        <button type="submit">Add Todo</button>
      </form>
    </div>
  )
}
```

:::info
The `onSuccessDeferred` interceptor defers execution, useful for updating states.
:::

### `createFormAction` Utility

The `createFormAction` utility accepts a [procedure](/docs/procedure) and returns a function to handle form submissions. It uses [Bracket Notation](/docs/openapi/bracket-notation) to deserialize form data.

```tsx
import { createFormAction } from '@orpc/react'

const dosomething = os
  .input(
    z.object({
      user: z.object({
        name: z.string(),
        age: z.coerce.number(),
      }),
    })
  )
  .handler(({ input }) => {
    console.log('Form action called!')
    console.log(input)
  })

export const redirectSomeWhereForm = createFormAction(dosomething, {
  interceptors: [
    onSuccess(async () => {
      redirect('/some-where')
    }),
  ],
})

export function MyComponent() {
  return (
    <form action={redirectSomeWhereForm}>
      <input type="text" name="user[name]" required />
      <input type="number" name="user[age]" required />
      <button type="submit">Submit</button>
    </form>
  )
}
```

By moving the `redirect('/some-where')` logic into `createFormAction` rather than the procedure, you enhance the procedure's reusability beyond Server Actions.

::: info
When using `createFormAction`, any `ORPCError` with a status of `401`, `403`, or `404` is automatically converted into the corresponding Next.js error responses: [unauthorized](https://nextjs.org/docs/app/api-reference/functions/unauthorized), [forbidden](https://nextjs.org/docs/app/api-reference/functions/forbidden), and [not found](https://nextjs.org/docs/app/api-reference/functions/not-found).
:::

### Form Data Utilities

The `@orpc/react` package re-exports [Form Data Helpers](/docs/helpers/form-data) for seamless form data parsing and validation error handling with [bracket notation](/docs/openapi/bracket-notation) support.

```tsx
import { getIssueMessage, parseFormData } from '@orpc/react'

export function MyComponent() {
  const { execute, data, error, status } = useServerAction(someAction)

  return (
    <form action={(form) => { execute(parseFormData(form)) }}>
      <label>
        Name:
        <input name="user[name]" type="text" />
        <span>{getIssueMessage(error, 'user[name]')}</span>
      </label>

      <label>
        Age:
        <input name="user[age]" type="number" />
        <span>{getIssueMessage(error, 'user[age]')}</span>
      </label>

      <label>
        Images:
        <input name="images[]" type="file" multiple />
        <span>{getIssueMessage(error, 'images[]')}</span>
      </label>

      <button disabled={status === 'pending'}>
        Submit
      </button>
    </form>
  )
}
```
