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

# @oRPC/zod

---

## Documentation

You can find the @orpc/server documentation [here](https://orpc.unnoq.com/docs/server/file-upload#enhanced-file-upload-with-orpczod).

---

## Installation

```bash
npm install @orpc/zod
pnpm install @orpc/zod
yarn add @orpc/zod
bun add @orpc/zod
```

---

## Example

```ts
import { os } from '@orpc/server'
import { oz } from '@orpc/zod'
import { z } from 'zod'

export const uploadFile = os.input(
  z.object({ file: oz.file().type('image/*') })
).func(async (input) => {
  const image: File = input.file
})

export const appRouter = os.router({
  uploadFile,
})
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
