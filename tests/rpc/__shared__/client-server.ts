import type { AnyRouter, Context, RouterClient } from '@orpc/server'
import { RPCSerializer } from '@orpc/client'

export interface ClientServerTestOptions {
  context?: Context
  serializer?: Pick<RPCSerializer, keyof RPCSerializer>
}

export interface CreateClientServerTest {
  <T extends AnyRouter>(router: T, options?: ClientServerTestOptions): RouterClient<T>
}

export class Person {
  class = '__PERSON__'

  constructor(
    public name: string,
    public age: number,
  ) {}
}

export const defaultSerializer = new RPCSerializer({
  handlers: {
    person: {
      condition: value => value instanceof Person,
      serialize: person => ({ name: person.name, age: person.age }),
      deserialize: data => new Person(data.name, data.age),
    },
  },
})
