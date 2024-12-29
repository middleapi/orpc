import { OpenAPIGenerator } from '@orpc/openapi'

import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { router } from '../api/[...rest]/router'

const openAPIGenerator = new OpenAPIGenerator({
  schemaConverters: [
    new ZodToJsonSchemaConverter(),
  ],
})

export async function GET(request: Request) {
  const spec = await openAPIGenerator.generate(router, {
    info: {
      title: 'ORPC Playground',
      version: '1.0.0',
      description: `
The example OpenAPI Playground for ORPC.

> **Note**
> This spec is generated without using \`.route()\` APIs, so you can see all methods is POST.

## Resources

* [Github](https://github.com/unnoq/orpc)
* [Documentation](https://orpc.unnoq.com)
          `,
    },
    servers: [{ url: '/api' /** Should use absolute URLs in production */ }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
    },
  })

  return new Response(JSON.stringify(spec), {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
