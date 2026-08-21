<h1 align="center">oRPC - Typesafe APIs Made Simple 🪄</h1>

<div align="center">
  <a href="https://codecov.io/gh/middleapi/orpc">
    <img alt="codecov" src="https://codecov.io/gh/middleapi/orpc/branch/main/graph/badge.svg">
  </a>
  <a href="https://npmx.dev/package/@orpc/experimental-msw">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dw/%40orpc%2Fexperimental-msw?logo=npm" />
  </a>
  <a href="https://app.codspeed.io/middleapi/orpc?utm_source=badge">
    <img alt="CodSpeed" src="https://img.shields.io/endpoint?url=https://codspeed.io/badge.json" />
  </a>
  <a href="https://github.com/middleapi/orpc/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/middleapi/orpc?logo=open-source-initiative" />
  </a>
  <a href="https://discord.gg/TXEbwRBvQn">
    <img alt="Discord" src="https://img.shields.io/discord/1308966753044398161?color=7389D8&label&logo=discord&logoColor=ffffff" />
  </a>
  <a href="https://deepwiki.com/middleapi/orpc">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki">
  </a>
</div>

## Documentation

You can read the documentation [here](https://orpc.dev).

## Packages

**Core**

- [@orpc/contract](https://npmx.dev/package/@orpc/contract): Define API contract as the single source of truth.
- [@orpc/server](https://npmx.dev/package/@orpc/server): Build APIs or implement contracts.
- [@orpc/client](https://npmx.dev/package/@orpc/client): Consume APIs with end-to-end type safety.
- [@orpc/openapi](https://npmx.dev/package/@orpc/openapi): Add OpenAPI compatibility to APIs.

**Schema validation**

- [@orpc/zod](https://npmx.dev/package/@orpc/zod): Integrate with [Zod](https://zod.dev/).
- [@orpc/valibot](https://npmx.dev/package/@orpc/valibot): Integrate with [Valibot](https://valibot.dev/).
- [@orpc/arktype](https://npmx.dev/package/@orpc/arktype): Integrate with [ArkType](https://arktype.io/).

**Built-in features**

- [@orpc/publisher](https://npmx.dev/package/@orpc/publisher): Pub/Sub with memory, Redis, and Upstash adapters.
- [@orpc/ratelimit](https://npmx.dev/package/@orpc/ratelimit): Rate limiting with memory, Redis, and Upstash adapters.
- [@orpc/hibernation](https://npmx.dev/package/@orpc/hibernation): Leverage Hibernation APIs like [Cloudflare's Hibernation WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#durable-objects-hibernation-websocket-api).
- [@orpc/json-schema](https://npmx.dev/package/@orpc/json-schema): Smart coercion for OpenAPI requests.

**Framework & ecosystem integrations**

- [@orpc/next](https://npmx.dev/package/@orpc/next): Integrate with [Next.js Server Functions](https://nextjs.org/docs/app/getting-started/mutating-data).
- [@orpc/ai-sdk](https://npmx.dev/package/@orpc/ai-sdk): Turn contracts and procedures into [AI SDK](https://ai-sdk.dev/) tools.
- [@orpc/tanstack-query](https://npmx.dev/package/@orpc/tanstack-query): Integrate with [TanStack Query](https://tanstack.com/query/latest).
- [@orpc/pinia-colada](https://npmx.dev/package/@orpc/pinia-colada): Integrate with [Pinia Colada](https://pinia-colada.esm.dev/).
- [@orpc/swr](https://npmx.dev/package/@orpc/swr): Integrate with [SWR](https://swr.vercel.app/).
- [@orpc/experimental-msw](https://npmx.dev/package/@orpc/experimental-msw): Mock procedures with [Mock Service Worker](https://mswjs.io/).
- [@orpc/experimental-effect](https://npmx.dev/package/@orpc/experimental-effect): Integrate with [Effect](https://effect.website/).
- [@orpc/nest](https://npmx.dev/package/@orpc/nest): Implement your contract with [NestJS](https://nestjs.com/).
- [@orpc/node](https://npmx.dev/package/@orpc/node): [Node.js](https://nodejs.org/) plugins for static file serving and large uploads.
- [@orpc/bun](https://npmx.dev/package/@orpc/bun): Adapters for [Bun's Redis](https://bun.sh/).
- [@orpc/cloudflare](https://npmx.dev/package/@orpc/cloudflare): Adapters for [Cloudflare's RateLimit and Durable Objects](https://developers.cloudflare.com/workers/).
- [@orpc/trpc](https://npmx.dev/package/@orpc/trpc): Reuse existing [tRPC](https://trpc.io/) routers within oRPC.

**Observability**

- [@orpc/opentelemetry](https://npmx.dev/package/@orpc/opentelemetry): Integrate with [OpenTelemetry](https://opentelemetry.io/) for distributed tracing.
- [@orpc/pino](https://npmx.dev/package/@orpc/pino): Integrate with [Pino](https://getpino.io/) for logging.
- [@orpc/evlog](https://npmx.dev/package/@orpc/evlog): Integrate with [Evlog](https://evlog.dev/) for logging.

## Sponsors

Like what we build over at [middleapi](https://github.com/middleapi)? You can help keep it going here: [GitHub Sponsors](https://github.com/sponsors/dinwwwh). Every bit helps! 🚀

### 🏆 Platinum Sponsor

<table>
  <tr>
   <td align="center"><a href="https://screenshotone.com/?ref=orpc" target="_blank" rel="sponsored noopener" title="ScreenshotOne.com"><img src="https://avatars.githubusercontent.com/u/97035603?v=4" width="279" alt="ScreenshotOne.com"/><br />ScreenshotOne.com</a></td>
  </tr>
</table>

### 🥈 Silver Sponsor

<table>
  <tr>
   <td align="center"><a href="https://misskey.io/?ref=orpc" target="_blank" rel="sponsored noopener" title="村上さん"><img src="https://avatars.githubusercontent.com/u/37681609?u=0dd4c7e4ba937cbb52b068c55914b1d8164dc0c7&amp;v=4" width="209" alt="村上さん"/><br />村上さん</a></td>
  </tr>
</table>

### Generous Sponsors

<table>
  <tr>
   <td align="center"><a href="https://github.com/ln-markets?ref=orpc" target="_blank" rel="sponsored noopener" title="LN Markets"><img src="https://avatars.githubusercontent.com/u/70597625?v=4" width="167" alt="LN Markets"/><br />LN Markets</a></td>
  </tr>
</table>

### Sponsors

<table>
  <tr>
   <td align="center"><a href="https://github.com/hrmcdonald?ref=orpc" target="_blank" rel="sponsored noopener" title="Reece McDonald"><img src="https://avatars.githubusercontent.com/u/39349270?v=4" width="139" alt="Reece McDonald"/><br />Reece McDonald</a></td>
   <td align="center"><a href="https://github.com/u1-liquid?ref=orpc" target="_blank" rel="sponsored noopener" title="あわわわとーにゅ"><img src="https://avatars.githubusercontent.com/u/17376330?u=de3353804be889f009f7e0a1582daf04d0ab292d&amp;v=4" width="139" alt="あわわわとーにゅ"/><br />あわわわとーにゅ</a></td>
   <td align="center"><a href="https://github.com/nicognaW?ref=orpc" target="_blank" rel="sponsored noopener" title="nk"><img src="https://avatars.githubusercontent.com/u/66731869?u=4699bda3a9092d3ec34fbd959450767bcc8b8b6d&amp;v=4" width="139" alt="nk"/><br />nk</a></td>
   <td align="center"><a href="https://github.com/supastarter?ref=orpc" target="_blank" rel="sponsored noopener" title="supastarter"><img src="https://avatars.githubusercontent.com/u/110960143?v=4" width="139" alt="supastarter"/><br />supastarter</a></td>
   <td align="center"><a href="https://github.com/divmgl?ref=orpc" target="_blank" rel="sponsored noopener" title="Dexter Miguel"><img src="https://avatars.githubusercontent.com/u/5452298?u=645993204be8696c085ecf0d228c3062efe2ed65&amp;v=4" width="139" alt="Dexter Miguel"/><br />Dexter Miguel</a></td>
   <td align="center"><a href="https://github.com/herrfugbaum?ref=orpc" target="_blank" rel="sponsored noopener" title="herrfugbaum"><img src="https://avatars.githubusercontent.com/u/12859776?u=644dc1666d0220bc0468eb0de3c56b919f635b16&amp;v=4" width="139" alt="herrfugbaum"/><br />herrfugbaum</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/ryota-murakami?ref=orpc" target="_blank" rel="sponsored noopener" title="Ryota Murakami"><img src="https://avatars.githubusercontent.com/u/5501268?u=599389e03340734325726ca3f8f423c021d47d7f&amp;v=4" width="139" alt="Ryota Murakami"/><br />Ryota Murakami</a></td>
   <td align="center"><a href="https://github.com/dcramer?ref=orpc" target="_blank" rel="sponsored noopener" title="David Cramer"><img src="https://avatars.githubusercontent.com/u/23610?v=4" width="139" alt="David Cramer"/><br />David Cramer</a></td>
   <td align="center"><a href="https://github.com/valerii15298?ref=orpc" target="_blank" rel="sponsored noopener" title="Valerii Petryniak"><img src="https://avatars.githubusercontent.com/u/44531564?u=88ac74d9bacd20401518441907acad21063cd397&amp;v=4" width="139" alt="Valerii Petryniak"/><br />Valerii Petryniak</a></td>
   <td align="center"><a href="https://github.com/letstri?ref=orpc" target="_blank" rel="sponsored noopener" title="Valerii Strilets"><img src="https://avatars.githubusercontent.com/u/13253748?u=c7b10399ccc8f8081e24db94ec32cd9858e86ac3&amp;v=4" width="139" alt="Valerii Strilets"/><br />Valerii Strilets</a></td>
   <td align="center"><a href="https://github.com/K-Mistele?ref=orpc" target="_blank" rel="sponsored noopener" title="Kyle Mistele"><img src="https://avatars.githubusercontent.com/u/18430555?u=3afebeb81de666e35aaac3ed46f14159d7603ffb&amp;v=4" width="139" alt="Kyle Mistele"/><br />Kyle Mistele</a></td>
   <td align="center"><a href="https://github.com/christ12938?ref=orpc" target="_blank" rel="sponsored noopener" title="christ12938"><img src="https://avatars.githubusercontent.com/u/25758598?v=4" width="139" alt="christ12938"/><br />christ12938</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/Ryanjso?ref=orpc" target="_blank" rel="sponsored noopener" title="Ryan Soderberg"><img src="https://avatars.githubusercontent.com/u/39172778?u=5ed913c31d57e7221b75784abcad48c7ebddde27&amp;v=4" width="139" alt="Ryan Soderberg"/><br />Ryan Soderberg</a></td>
   <td align="center"><a href="https://github.com/itigoore01?ref=orpc" target="_blank" rel="sponsored noopener" title="shota"><img src="https://avatars.githubusercontent.com/u/11831107?u=c976a6dc7e055eb026304c46c99100ed22b0c8e0&amp;v=4" width="139" alt="shota"/><br />shota</a></td>
   <td align="center"><a href="https://github.com/ellis-driscoll?ref=orpc" target="_blank" rel="sponsored noopener" title="Ellis Driscoll"><img src="https://avatars.githubusercontent.com/u/70685966?u=c5f95bc33b5991d9744abe00052542e4a2ed3cb9&amp;v=4" width="139" alt="Ellis Driscoll"/><br />Ellis Driscoll</a></td>
   <td align="center"><a href="https://github.com/hoangbn?ref=orpc" target="_blank" rel="sponsored noopener" title="Hoang Nguyen"><img src="https://avatars.githubusercontent.com/u/38968280?u=c90084c6de65c56facabab7ba13a72a49ddbc3e4&amp;v=4" width="139" alt="Hoang Nguyen"/><br />Hoang Nguyen</a></td>
  </tr>
</table>

### Backers

<table>
  <tr>
   <td align="center"><a href="https://github.com/rhinodavid?ref=orpc" target="_blank" rel="sponsored noopener" title="David Walsh"><img src="https://avatars.githubusercontent.com/u/5778036?u=b5521f07d2f88c3db2a0dae62b5f2f8357214af0&amp;v=4" width="119" alt="David Walsh"/><br />David Walsh</a></td>
   <td align="center"><a href="https://github.com/Robbe95?ref=orpc" target="_blank" rel="sponsored noopener" title="Robbe Vaes"><img src="https://avatars.githubusercontent.com/u/44748019?u=e0232402c045ad4eac7cbd217f1f47e083103b89&amp;v=4" width="119" alt="Robbe Vaes"/><br />Robbe Vaes</a></td>
   <td align="center"><a href="https://github.com/aidansunbury?ref=orpc" target="_blank" rel="sponsored noopener" title="Aidan Sunbury"><img src="https://avatars.githubusercontent.com/u/64103161?v=4" width="119" alt="Aidan Sunbury"/><br />Aidan Sunbury</a></td>
   <td align="center"><a href="https://github.com/soonoo?ref=orpc" target="_blank" rel="sponsored noopener" title="soonoo"><img src="https://avatars.githubusercontent.com/u/5436405?u=5d0b4aa955c87e30e6bda7f0cccae5402da99528&amp;v=4" width="119" alt="soonoo"/><br />soonoo</a></td>
   <td align="center"><a href="https://github.com/kporten?ref=orpc" target="_blank" rel="sponsored noopener" title="Kevin Porten"><img src="https://avatars.githubusercontent.com/u/1839345?u=dc2263d5cfe0d927ce1a0be04a1d55dd6b55405c&amp;v=4" width="119" alt="Kevin Porten"/><br />Kevin Porten</a></td>
   <td align="center"><a href="https://github.com/pumpkinlink?ref=orpc" target="_blank" rel="sponsored noopener" title="Denis"><img src="https://avatars.githubusercontent.com/u/11864620?u=5f47bbe6c65d0f6f5cf011021490238e4b0593d0&amp;v=4" width="119" alt="Denis"/><br />Denis</a></td>
   <td align="center"><a href="https://github.com/christopher-kapic?ref=orpc" target="_blank" rel="sponsored noopener" title="Christopher Kapic"><img src="https://avatars.githubusercontent.com/u/59740769?u=e7ad4b72b5bf6c9eb1644c26dbf3332a8f987377&amp;v=4" width="119" alt="Christopher Kapic"/><br />Christopher Kapic</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/thomasballinger?ref=orpc" target="_blank" rel="sponsored noopener" title="Tom Ballinger"><img src="https://avatars.githubusercontent.com/u/458879?u=4b045ac75d721b6ac2b42a74d7d37f61f0414031&amp;v=4" width="119" alt="Tom Ballinger"/><br />Tom Ballinger</a></td>
   <td align="center"><a href="https://github.com/SSam0419?ref=orpc" target="_blank" rel="sponsored noopener" title="Sam"><img src="https://avatars.githubusercontent.com/u/102863520?u=3c89611f549d5070be232eb4532f690c8f2e7a65&amp;v=4" width="119" alt="Sam"/><br />Sam</a></td>
   <td align="center"><a href="https://github.com/Titoine?ref=orpc" target="_blank" rel="sponsored noopener" title="Titoine"><img src="https://avatars.githubusercontent.com/u/3514286?u=1bb1e86b0c99c8a1121372e56d51a177eea12191&amp;v=4" width="119" alt="Titoine"/><br />Titoine</a></td>
   <td align="center"><a href="https://github.com/Mnigos?ref=orpc" target="_blank" rel="sponsored noopener" title="Igor Makowski"><img src="https://avatars.githubusercontent.com/u/56691628?u=ee8c879478f7c151b9156aef6c74243fa3e247a8&amp;v=4" width="119" alt="Igor Makowski"/><br />Igor Makowski</a></td>
   <td align="center"><a href="https://github.com/hanayashiki?ref=orpc" target="_blank" rel="sponsored noopener" title="hanayashiki"><img src="https://avatars.githubusercontent.com/u/26056783?u=06c3b9205a16fd41a871e82da1cc2a09306d53f5&amp;v=4" width="119" alt="hanayashiki"/><br />hanayashiki</a></td>
   <td align="center"><a href="https://github.com/ldub?ref=orpc" target="_blank" rel="sponsored noopener" title="Lev Dubinets"><img src="https://avatars.githubusercontent.com/u/3114081?u=f547f5d5012cab54851f1b1ad72d10e537f78fc2&amp;v=4" width="119" alt="Lev Dubinets"/><br />Lev Dubinets</a></td>
   <td align="center"><a href="https://github.com/mr-kelly?ref=orpc" target="_blank" rel="sponsored noopener" title="Kelly Peilin Chan"><img src="https://avatars.githubusercontent.com/u/520852?u=6b0f7105f694e7b5cacf410a3f04c7044b469dc8&amp;v=4" width="119" alt="Kelly Peilin Chan"/><br />Kelly Peilin Chan</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/guyariely?ref=orpc" target="_blank" rel="sponsored noopener" title="Guy Ariely"><img src="https://avatars.githubusercontent.com/u/42813496?u=edb6b7f563bf28e160a290832e7da57c0506f8ca&amp;v=4" width="119" alt="Guy Ariely"/><br />Guy Ariely</a></td>
   <td align="center"><a href="https://github.com/piscis?ref=orpc" target="_blank" rel="sponsored noopener" title="Alex"><img src="https://avatars.githubusercontent.com/u/326163?u=b245f368bd940cf51d08c0b6bf55f8257f359437&amp;v=4" width="119" alt="Alex"/><br />Alex</a></td>
   <td align="center"><a href="https://github.com/finom?ref=orpc" target="_blank" rel="sponsored noopener" title="Andrey Gubanov"><img src="https://avatars.githubusercontent.com/u/1082083?u=c5f2daf7ebece498e85c83367bb37b4e10e2649d&amp;v=4" width="119" alt="Andrey Gubanov"/><br />Andrey Gubanov</a></td>
  </tr>
</table>

With thanks to 37 past sponsors who helped get oRPC here.

## References

oRPC is inspired by existing solutions that prioritize type safety and developer experience. Special acknowledgments to:

- [tRPC](https://trpc.io): For pioneering the concept of end-to-end type-safe RPC and influencing the development of type-safe APIs.
- [ts-rest](https://ts-rest.com): For its emphasis on contract-first development and OpenAPI integration, which have greatly inspired oRPC's feature set.

## License

Distributed under the MIT License. See [LICENSE](https://github.com/middleapi/orpc/blob/main/LICENSE) for more information.
