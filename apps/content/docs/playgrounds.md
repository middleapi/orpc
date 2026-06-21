# Playgrounds

Explore oRPC implementations through our interactive playgrounds,
featuring pre-configured examples accessible instantly via StackBlitz or local setup.

## Available Playgrounds

| Environment        | StackBlitz                                                                                    | GitHub Source                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Next.js Playground | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/main/playgrounds/next) | [View Source](https://github.com/middleapi/orpc/tree/main/playgrounds/next) |

:::warning
StackBlitz has its own limitations, so some features may not work as expected.
:::

## Local Development

Prefer working locally? Clone the playground with:

```bash
npx degit middleapi/orpc/playgrounds/next orpc-next-playground
```

Then install dependencies and start the dev server:

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

- Visit [http://localhost:3000](http://localhost:3000) to view the app.
- Visit [http://localhost:3000/api](http://localhost:3000/api) to explore the OpenAPI client.

### OpenTelemetry

Collect OpenTelemetry traces with [Jaeger](https://www.jaegertracing.io/) by running this in a separate terminal:

```bash
npm run jaeger:run
```

Then play with your app and open [http://localhost:16686](http://localhost:16686) to see the traces in the Jaeger dashboard.
