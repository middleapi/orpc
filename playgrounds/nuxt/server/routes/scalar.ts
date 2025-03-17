export default defineEventHandler(async (event) => {
  const html = `
      <!doctype html>
      <html>
      <head>
          <title>ORPC Playground</title>
          <meta charset="utf-8" />
          <meta
          name="viewport"
          content="width=device-width, initial-scale=1" />

          <link rel="icon" type="image/svg+xml" href="https://orpc.unnoq.com/icon.svg" />
      </head>
      <body>
          <script
          id="api-reference"
          data-url="/spec"
          data-configuration="${JSON.stringify({
            authentication: {
              preferredSecurityScheme: 'bearerAuth',
              http: {
                bearer: {
                  token: 'default-token',
                },
              },
            },
          }).replaceAll('"', '&quot;')}"
          ></script>

          <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
      </body>
      </html>
    `

  setResponseHeader(event, 'content-type', 'text/html')
  return html
})
