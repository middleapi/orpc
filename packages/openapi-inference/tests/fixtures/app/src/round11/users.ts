import { impl } from './contract'

export const getUser = impl.users.get.handler(() => ({ id: '1', name: 'Ada' }))
