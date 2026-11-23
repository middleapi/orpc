import { TmpFileUploadHandlerPlugin } from './tmp-file-upload-handler-plugin'

describe('TmpFileUploadHandlerPlugin', () => {
  it('requires maxBodySize with every kind', () => {
    void new TmpFileUploadHandlerPlugin({ maxBodySize: { memory: 1, file: 1, stream: 1 } })
    void new TmpFileUploadHandlerPlugin({
      maxBodySize: async () => ({ memory: 1, file: 1, stream: 1 }),
    })

    // @ts-expect-error - options are required
    void new TmpFileUploadHandlerPlugin()
    // @ts-expect-error - maxBodySize is required
    void new TmpFileUploadHandlerPlugin({})
    // @ts-expect-error - every kind is required
    void new TmpFileUploadHandlerPlugin({ maxBodySize: { memory: 1, file: 1 } })
  })
})
