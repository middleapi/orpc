<div align="center">
  <image align="center" src="https://i.ibb.co/rZw671M/New-Project-2.png" width=400 />
</div>

<h1></h1>

<div align="center">

![NPM Downloads](https://img.shields.io/npm/dm/%40orpc/server?logo=npm)
![GitHub Release](https://img.shields.io/github/v/release/unnoq/orpc?logo=github)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/unnoq/orpc?logo=git&logoColor=%23fff)
![GitHub License](https://img.shields.io/github/license/unnoq/orpc)

</div>

> This project is still in heavy development, please be mindful of breaking changes.

# @oRPC/openapi

---

## Documentation

You can find the @orpc/openapi documentation [here](https://orpc.unnoq.com/docs/server/openapi).

---

## Installation

```bash
npm install @orpc/openapi
pnpm install @orpc/openapi
yarn add @orpc/openapi
bun add @orpc/openapi
```

---

## Example

##### `server.ts`

```ts
import { ORPCError, os } from '@orpc/server'
import { oz } from '@orpc/zod'
import { z } from 'zod'

export const router = publicRouter.router({
  getUser: publicRouter.getUser.func(async (input, context, meta) => {
    return {
      id: '1234567890',
      username: 'david',
    }
  }),
})
```

##### `openapi.ts`

```ts
import { generateOpenAPI } from '@orpc/openapi'
import { contract } from './contract'
import { router } from './server'

const spec = generateOpenAPI({
  router: contract, // Both router and contract are supported
  info: {
    title: 'My API',
    version: '0.0.0',
  },
})

console.log(JSON.stringify(spec, null, 2))
```

#### `Output`

```json
{
  "info": {
    "title": "My API",
    "version": "0.0.0"
  },
  "openapi": "3.1.0",
  "paths": {
    "/getUser": {
      "get": {
        "operationId": "getUser",
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string"
                  }
                },
                "required": ["id"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "username": {
                      "type": "string"
                    }
                  },
                  "required": ["id", "username"]
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
