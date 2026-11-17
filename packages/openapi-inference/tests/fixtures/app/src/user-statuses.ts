export const USER_STATUSES = ['active', 'inactive'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export interface User {
  id: string
  status: UserStatus
}
