const DOOR_STATES = ['open', 'closed'] as const
type DoorState = (typeof DOOR_STATES)[number]

export interface Workspace {
  state: DoorState
}
