const TICKET_STATES = ['open', 'closed'] as const
type TicketState = (typeof TICKET_STATES)[number]

export interface Account {
  status: TicketState
}
