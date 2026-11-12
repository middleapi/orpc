// a declaration file of a built package, whose dependency is not installed
export interface Box {
  label: string
  inner: import('@acme/not-installed').Inner
}
