// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

const stream = (): ReadableStream<string> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue('a')
      controller.close()
    },
  })

const form = (): FormData => {
  const data = new FormData()
  data.append('a', 'b')
  return data
}

// whole bodies of built-ins reached through an interface or an intersection
interface UploadForm extends FormData {}
interface TextStream extends ReadableStream<string> {}

export const roundSeventyEight = {
  uploadFormBody: os.handler((): UploadForm => form()),
  taggedFormBody: os.handler((): FormData & { tag?: string } => form()),
  textStreamBody: os.handler((): TextStream => stream()),
  taggedParamsBody: os.handler(
    (): URLSearchParams & { tag?: string } => new URLSearchParams('a=1'),
  ),
  uploadFormInput: os.input(type<UploadForm>()).handler(() => 1),
  taggedFormInput: os.input(type<FormData & { tag?: string }>()).handler(() => 1),
  textStreamInput: os.input(type<TextStream>()).handler(() => 1),

  // the body of a detailed output or input is sent as is
  detailedFormBody: os
    .route({ outputStructure: 'detailed' })
    .handler((): { headers: { 'x-id': string }; body: FormData } => ({
      headers: { 'x-id': 'a' },
      body: form(),
    })),
  detailedStreamBody: os
    .route({ outputStructure: 'detailed' })
    .handler((): { body: ReadableStream<string> | null } => ({ body: stream() })),
  detailedFormInput: os
    .route({ inputStructure: 'detailed' })
    .input(type<{ query: { a?: string }; body: FormData }>())
    .handler(() => 1),
  detailedParamsInput: os
    .route({ inputStructure: 'detailed' })
    .input(type<{ body?: URLSearchParams }>())
    .handler(() => 1),
}

/** The values a client sends of the inputs above */
export const roundSeventyEightInputs: Record<string, () => unknown> = {
  uploadFormInput: form,
  taggedFormInput: form,
  textStreamInput: stream,
  detailedFormInput: () => ({ query: { a: 'b' }, body: form() }),
  detailedParamsInput: () => ({ body: new URLSearchParams('a=1') }),
}
