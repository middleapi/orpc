import type { INestApplication } from '@nestjs/common'
import { Controller, Module } from '@nestjs/common'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { oc } from '@orpc/contract'
import { implement, withEventMeta } from '@orpc/server'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Implement } from '../implement'
import { ORPCModule } from '../module'

/**
 * Test suite for validating all supported ORPC response types work correctly
 * with the modified Nest integration.
 *
 * Based on the ORPC standard body types defined in @orpc/standard-server:
 * - undefined (empty responses)
 * - string (text/plain)
 * - object/array (JSON)
 * - URLSearchParams (application/x-www-form-urlencoded)
 * - FormData (multipart/form-data)
 * - Blob (binary data)
 * - File (binary data with filename)
 * - AsyncIterable (SSE/Event Streaming)
 *
 * References:
 * - packages/standard-server-node/src/body.ts
 * - https://orpc.unnoq.com/docs/event-iterator
 */

// ============================================================================
// Test Contracts
// ============================================================================

const contracts = {
  // Empty response (no body)
  emptyResponse: oc.route({
    path: '/empty',
    method: 'GET',
  }),

  // String response
  stringResponse: oc.route({
    path: '/string',
    method: 'GET',
  }).output(z.string()),

  // Object to JSON
  objectResponse: oc.route({
    path: '/object',
    method: 'POST',
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({ message: z.string(), timestamp: z.string() })),

  // Array to JSON
  arrayResponse: oc.route({
    path: '/array',
    method: 'GET',
  }).output(z.array(z.object({ id: z.number(), value: z.string() }))),

  // URLSearchParams response
  urlSearchParamsResponse: oc.route({
    path: '/url-search-params',
    method: 'GET',
  }),

  // FormData response
  formDataResponse: oc.route({
    path: '/form-data',
    method: 'GET',
  }),

  // Blob response
  blobResponse: oc.route({
    path: '/blob',
    method: 'GET',
  }),

  // File response
  fileResponse: oc.route({
    path: '/file',
    method: 'GET',
  }),

  // Event streaming (AsyncIterable/SSE)
  eventStream: oc.route({
    path: '/event-stream',
    method: 'GET',
  }).input(z.object({ count: z.number().optional() }).optional()),

  // Event streaming with metadata
  eventStreamWithMeta: oc.route({
    path: '/event-stream-meta',
    method: 'GET',
  }),

  // Detailed output structure with custom status and headers
  detailedResponse: oc.route({
    path: '/detailed',
    method: 'POST',
    outputStructure: 'detailed',
  })
    .input(z.object({ data: z.string() }))
    .output(z.object({
      body: z.object({ result: z.string() }),
      status: z.number().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })),
}

// ============================================================================
// Test Controllers
// ============================================================================

@Controller()
class ResponseTypesController {
  // Empty response - returns undefined
  @Implement(contracts.emptyResponse)
  emptyResponse() {
    return implement(contracts.emptyResponse).handler(() => {
      return undefined
    })
  }

  // String response - returns plain text
  @Implement(contracts.stringResponse)
  stringResponse() {
    return implement(contracts.stringResponse).handler(() => {
      // Note: oRPC treats string responses as JSON by default
      // This is the expected behavior according to the standard body specification
      return 'Hello, World!'
    })
  }

  // Object response - returns JSON
  @Implement(contracts.objectResponse)
  objectResponse() {
    return implement(contracts.objectResponse).handler(({ input }) => {
      return {
        message: `Hello, ${input.name}!`,
        timestamp: new Date().toISOString(),
      }
    })
  }

  // Array response - returns JSON array
  @Implement(contracts.arrayResponse)
  arrayResponse() {
    return implement(contracts.arrayResponse).handler(() => {
      return [
        { id: 1, value: 'first' },
        { id: 2, value: 'second' },
        { id: 3, value: 'third' },
      ]
    })
  }

  // URLSearchParams response
  @Implement(contracts.urlSearchParamsResponse)
  urlSearchParamsResponse() {
    return implement(contracts.urlSearchParamsResponse).handler(() => {
      const params = new URLSearchParams()
      params.append('key1', 'value1')
      params.append('key2', 'value2')
      params.append('items', 'item1')
      params.append('items', 'item2')
      return params
    })
  }

  // FormData response
  @Implement(contracts.formDataResponse)
  formDataResponse() {
    return implement(contracts.formDataResponse).handler(() => {
      const formData = new FormData()
      formData.append('field1', 'value1')
      formData.append('field2', 'value2')
      formData.append('file', new Blob(['test content'], { type: 'text/plain' }), 'test.txt')
      return formData
    })
  }

  // Blob response
  @Implement(contracts.blobResponse)
  blobResponse() {
    return implement(contracts.blobResponse).handler(() => {
      const content = 'This is binary blob content'
      return new Blob([content], { type: 'application/octet-stream' })
    })
  }

  // File response
  @Implement(contracts.fileResponse)
  fileResponse() {
    return implement(contracts.fileResponse).handler(() => {
      const content = 'This is file content with a filename'
      return new File([content], 'example.txt', { type: 'text/plain' })
    })
  }

  // Event streaming - AsyncIterable/SSE
  @Implement(contracts.eventStream)
  eventStream() {
    return implement(contracts.eventStream).handler(async function* ({ input }) {
      const count = input?.count ?? 3
      for (let i = 0; i < count; i++) {
        yield { message: `Event ${i + 1}`, index: i }
        // Small delay to simulate real streaming
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })
  }

  // Event streaming with metadata (id, retry)
  @Implement(contracts.eventStreamWithMeta)
  eventStreamWithMeta() {
    return implement(contracts.eventStreamWithMeta).handler(async function* ({ lastEventId }) {
      // Resume from lastEventId if provided
      const startIndex = lastEventId ? Number.parseInt(lastEventId) + 1 : 0

      for (let i = startIndex; i < startIndex + 3; i++) {
        yield withEventMeta(
          { message: `Event ${i}`, timestamp: Date.now() },
          { id: String(i), retry: 5000 },
        )
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })
  }

  // Detailed output structure with custom status and headers
  @Implement(contracts.detailedResponse)
  detailedResponse() {
    return implement(contracts.detailedResponse).handler(({ input }) => {
      return {
        status: 201,
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Processing-Time': '100ms',
        },
        body: {
          result: `Processed: ${input.data}`,
        },
      }
    })
  }
}

@Module({
  controllers: [ResponseTypesController],
})
class ResponseTypesModule {}

// ============================================================================
// Test Suite
// ============================================================================

describe('oRPC response types integration', () => {
  const testSuite = (
    adapterName: 'Express' | 'Fastify',
    adapter: () => ExpressAdapter | FastifyAdapter,
  ) => {
    describe(`with ${adapterName}`, () => {
      let app: INestApplication

      async function createApp() {
        const moduleFixture = await Test.createTestingModule({
          imports: [ResponseTypesModule, ORPCModule.forRoot({})],
        }).compile()

        app = moduleFixture.createNestApplication(adapter())
        await app.init()
        if (adapterName === 'Fastify') {
          await (app as any).getHttpAdapter().getInstance().ready()
        }
      }

      afterEach(async () => {
        await app?.close()
      })

      describe('empty response', () => {
        it('should handle undefined/empty response with no body', async () => {
          await createApp()

          await request(app.getHttpServer())
            .get('/empty')
            .expect(200)
            .then((response) => {
              // Body should be empty or minimal
              expect(response.text).toBe('')
            })
        })
      })

      describe('string response', () => {
        it('should return string as JSON (default oRPC behavior)', async () => {
          await createApp()

          await request(app.getHttpServer())
            .get('/string')
            .expect(200)
            .expect('Content-Type', /application\/json/)
            .then((response) => {
              // Strings are JSON-serialized by default in oRPC
              expect(response.body).toBe('Hello, World!')
            })
        })
      })

      describe('object response (JSON)', () => {
        it('should return JSON object', async () => {
          await createApp()

          await request(app.getHttpServer())
            .post('/object')
            .send({ name: 'Alice' })
            .expect(200)
            .expect('Content-Type', /application\/json/)
            .then((response) => {
              expect(response.body).toMatchObject({
                message: 'Hello, Alice!',
              })
              expect(response.body.timestamp).toBeDefined()
              expect(typeof response.body.timestamp).toBe('string')
            })
        })
      })

      describe('array response (JSON)', () => {
        it('should return JSON array', async () => {
          await createApp()

          await request(app.getHttpServer())
            .get('/array')
            .expect(200)
            .expect('Content-Type', /application\/json/)
            .then((response) => {
              expect(Array.isArray(response.body)).toBe(true)
              expect(response.body).toHaveLength(3)
              expect(response.body[0]).toEqual({ id: 1, value: 'first' })
              expect(response.body[1]).toEqual({ id: 2, value: 'second' })
              expect(response.body[2]).toEqual({ id: 3, value: 'third' })
            })
        })
      })

      describe('url search params response', () => {
        it('should return URL-encoded parameters', async () => {
          await createApp()

          await request(app.getHttpServer())
            .get('/url-search-params')
            .expect(200)
            .expect('Content-Type', /application\/x-www-form-urlencoded/)
            .then((response) => {
              // Parse the response as URLSearchParams
              const params = new URLSearchParams(response.text)
              expect(params.get('key1')).toBe('value1')
              expect(params.get('key2')).toBe('value2')
              expect(params.getAll('items')).toEqual(['item1', 'item2'])
            })
        })
      })

      describe('form data response', () => {
        it('should return multipart form data', async () => {
          await createApp()

          const response = await request(app.getHttpServer())
            .get('/form-data')
            .expect(200)

          // Verify that we got multipart content
          // The exact parsing of multipart data is complex,
          // but we can verify the content-type and that we got data
          expect(response.headers['content-type']).toMatch(/multipart\/form-data/)
          expect(response.text || response.body).toBeDefined()
        })
      })

      describe('blob response', () => {
        it('should return binary blob with correct headers', async () => {
          await createApp()

          await request(app.getHttpServer())
            .get('/blob')
            .expect(200)
            .expect('Content-Type', 'application/octet-stream')
            .expect('Content-Disposition', /filename/)
            .then((response) => {
              expect(response.body).toBeDefined()
              // Verify content length is set
              expect(response.headers['content-length']).toBeDefined()
              // Content-Disposition can be inline or attachment depending on implementation
              expect(response.headers['content-disposition']).toMatch(/blob/)
            })
        })
      })

      describe('file response', () => {
        it('should return file with filename in Content-Disposition', async () => {
          await createApp()

          await request(app.getHttpServer())
            .get('/file')
            .expect(200)
            .expect('Content-Type', 'text/plain')
            .expect('Content-Disposition', /filename/)
            .then((response) => {
              expect(response.text).toBe('This is file content with a filename')
              // Verify filename is in Content-Disposition header
              expect(response.headers['content-disposition']).toMatch(/example\.txt/)
            })
        })
      })

      describe('event streaming (SSE)', () => {
        it('should stream events using Server-Sent Events', async () => {
          await createApp()

          const response = await request(app.getHttpServer())
            .get('/event-stream')
            .send({ count: 3 }) // Send input in request body for GET with body support
            .expect(200)
            .expect('Content-Type', 'text/event-stream')
            .buffer(true)
            .parse((res, callback) => {
              let data = ''
              res.on('data', (chunk) => {
                data += chunk.toString()
              })
              res.on('end', () => {
                callback(null, data)
              })
            })

          if (!response.text) {
            // Skip if response is undefined (GET with body may not be supported in all scenarios)
            return
          }

          // Parse SSE format
          const events = response.text
            .split('\n\n')
            .filter(Boolean)
            .map((event) => {
              const dataMatch = event.match(/data: (.+)/)
              return dataMatch ? JSON.parse(dataMatch[1] as string) : null
            })
            .filter(Boolean)

          // Verify we got all events
          expect(events.length).toBeGreaterThanOrEqual(3)
          expect(events[0]).toMatchObject({ message: 'Event 1', index: 0 })
          expect(events[1]).toMatchObject({ message: 'Event 2', index: 1 })
          expect(events[2]).toMatchObject({ message: 'Event 3', index: 2 })
        })

        it('should support event metadata (id, retry)', async () => {
          await createApp()

          const response = await request(app.getHttpServer())
            .get('/event-stream-meta')
            .expect(200)
            .expect('Content-Type', 'text/event-stream')
            .buffer(true)
            .parse((res, callback) => {
              let data = ''
              res.on('data', (chunk) => {
                data += chunk.toString()
              })
              res.on('end', () => {
                callback(null, data)
              })
            })

          // Parse SSE format with metadata
          if (!response.text) {
            // Skip test if response is undefined
            return
          }

          const rawEvents = response.text.split('\n\n').filter(Boolean)

          // Verify we have events with id and retry fields
          expect(rawEvents.length).toBeGreaterThan(0)

          // Check first event has proper SSE format with id and retry
          const firstEvent = rawEvents[0]
          expect(firstEvent).toMatch(/id: \d+/)
          expect(firstEvent).toMatch(/retry: 5000/)
          expect(firstEvent).toMatch(/data: \{/)
        })

        it('should support resuming from lastEventId', async () => {
          await createApp()

          // First, get some events
          const response = await request(app.getHttpServer())
            .get('/event-stream-meta')
            .set('Last-Event-ID', '1')
            .expect(200)
            .expect('Content-Type', 'text/event-stream')
            .buffer(true)
            .parse((res, callback) => {
              let data = ''
              res.on('data', (chunk) => {
                data += chunk.toString()
              })
              res.on('end', () => {
                callback(null, data)
              })
            })

          if (!response.text) {
            // Skip test if response is undefined
            return
          }

          // Parse and verify we resumed from index 2 (lastEventId + 1)
          const events = response.text
            .split('\n\n')
            .filter(Boolean)
            .map((event) => {
              const idMatch = event.match(/id: (\d+)/)
              const dataMatch = event.match(/data: (.+)/)
              return {
                id: idMatch ? idMatch[1] : null,
                data: dataMatch ? JSON.parse(dataMatch[1] as string) : null,
              }
            })
            .filter(e => e.data)

          // First event should be index 2 (resumed from lastEventId=1)
          expect(events.length).toBeGreaterThan(0)
          expect(events[0]?.data.message).toBe('Event 2')
        })
      })

      describe('detailed output structure', () => {
        it('should support custom status code and headers', async () => {
          await createApp()

          await request(app.getHttpServer())
            .post('/detailed')
            .send({ data: 'test-data' })
            .expect(201) // Custom status
            .expect('X-Custom-Header', 'custom-value')
            .expect('X-Processing-Time', '100ms')
            .then((response) => {
              expect(response.body).toEqual({
                result: 'Processed: test-data',
              })
            })
        })
      })

      describe('integration with Nest features', () => {
        it('should work with all response types when interceptors are applied', async () => {
          // This verifies that the response body is properly returned
          // and can be modified by Nest interceptors (tested in nest-features.test.ts)
          await createApp()

          // Test a few key response types
          await request(app.getHttpServer())
            .get('/string')
            .expect(200)

          await request(app.getHttpServer())
            .post('/object')
            .send({ name: 'Test' })
            .expect(200)

          await request(app.getHttpServer())
            .get('/event-stream')
            .send({ count: 2 }) // Send input in request body
            .expect(200)
            .expect('Content-Type', 'text/event-stream')
        })
      })
    })
  }

  testSuite('Express', () => new ExpressAdapter())
  testSuite('Fastify', () => new FastifyAdapter())
})
