import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { z } from 'zod'
import { mcp } from './meta'

describe('mcp.tool meta', () => {
  it('can be used with contracts and procedures', () => {
    oc.meta(mcp.tool({ name: 'get_planet' })).input(z.object({ id: z.number() }))
    os.meta(mcp.tool({ title: 'Get a planet' })).input(z.object({ id: z.number() })).handler(() => {})
  })

  it('types the tool options', () => {
    mcp.tool({
      name: 'get_planet',
      title: 'Get a planet',
      description: 'Get a planet by id',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      icons: [{ src: 'https://example.com/icon.png', mimeType: 'image/png', sizes: ['48x48'] }],
      _meta: { source: 'planets' },
    })

    // @ts-expect-error invalid annotation
    mcp.tool({ annotations: { readOnlyHint: 'yes' } })
    // @ts-expect-error unknown option
    mcp.tool({ inputSchema: {} })
  })
})
