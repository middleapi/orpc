/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

export interface FetchWithContext<TClientContext> {
  (input: RequestInfo | URL, init: RequestInit | undefined, context: TClientContext): Promise<Response>
}
