import type { UserId } from '@/lib/ids'

export type Role = 'admin' | 'member'

export interface User {
  id: UserId
  name: string
  role: Role
  /**
   * Reputation
   * @exclusiveMinimum 0
   * @example 4.5
   */
  score: number
  nickname: string | null
  location: [lat: number, lng: number]
  createdAt: Date
}

export type CreateUserInput = Omit<User, 'id' | 'createdAt'>
