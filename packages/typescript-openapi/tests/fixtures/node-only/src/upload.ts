export interface Upload {
  file: File
  blob: Blob
  url: URL
}

/** Web classes, declared by the Node typings without the DOM library */
export interface WebClasses {
  response: Response
  request: Request
}
