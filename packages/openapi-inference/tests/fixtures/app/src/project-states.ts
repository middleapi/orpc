// a repository module, whose alias of the same items as `UserStatus` no procedure file imports
export const PROJECT_STATES = ['active', 'inactive'] as const
export type ProjectState = (typeof PROJECT_STATES)[number]

export interface ProjectRow {
  id: string
  state: ProjectState
  secret: string
}

export function getState(): ProjectState {
  return 'active'
}

export async function loadProject(id: string): Promise<ProjectRow> {
  return { id, state: 'active', secret: 's' }
}
