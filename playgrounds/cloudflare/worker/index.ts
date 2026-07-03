export default {
  fetch(request) {
    const url = new URL(request.url)
    console.log('Request URL:', url.href)

    if (url.pathname.startsWith('/api/')) {
      return Response.json({
        name: 'Cloudflare',
      })
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
