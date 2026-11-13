import { os } from '@orpc/server'

const usersRouter = { list: os.handler(() => [1]) }

/** A sub-router typed `any`, whose procedures have no types to infer from */
export const roundEightyFourAny = {
  health: os.handler(() => 'ok'),
  users: usersRouter as any,
}
