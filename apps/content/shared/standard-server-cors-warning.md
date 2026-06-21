::: warning
To better support `Blob`, `File`, and `ReadableStream<Uint8Array>` at the root level in cross-origin scenarios,
extend your [CORS allowlist](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header) to allow clients to send and receive the `Content-Disposition` and `Standard-Server` headers. Learn more in the [Standard Server documentation](https://github.com/middleapi/standardserver#resolving-body). If you use the [CORS Plugin](/docs/plugins/cors), include them in `allowHeaders` and `exposeHeaders`:

```ts
const cors = new CORSHandlerPlugin({
  allowHeaders: ['Content-Disposition', 'Standard-Server'],
  exposeHeaders: ['Content-Disposition', 'Standard-Server'],
})
```

:::
