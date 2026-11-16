/** A class, whose fields hold no parameters when it is the root */
export class SearchClass {
  page = 1
  since = new Date()
}

/** A plain object, whose fields hold the parameters */
export interface Search {
  page: number
  since: Date
}

/** An array, whose items hold no parameters when it is the root */
export type Pages = Search[]

/** A class with a private member, which only an instance satisfies */
export class Cursor {
  private position = 0
  id = 1
}

/** A class, which a plain object satisfies too */
export class Origin {
  x = 1
}

export interface CursorQuery {
  cursor: Cursor
  origin: Origin
}

/** Written as a def, which may be `null` */
export type Mode = 'fast' | 'slow' | null

/** Headers a client may all leave out, also through a def */
export interface OptionalHeaders {
  headers: {
    'x-mode': Mode
    'x-trace': string | null
  }
}

/** Headers of which a client always sends one */
export interface SomeHeaders {
  headers: {
    'x-mode': Mode
    'x-id': string
  }
}
