import { Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller'
import { PlanetController } from './planet/planet.controller'
import { OtherController } from './other/other.controller'
import { PlanetService } from './planet/planet.service'
import { ReferenceController } from './reference/reference.controller'
import { ReferenceService } from './reference/reference.service'
import { onError, ORPCModule } from '@orpc/nest'
import { REQUEST } from '@nestjs/core'
import { experimental_SmartCoercionPlugin as SmartCoercionPlugin } from '@orpc/json-schema'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { Request } from 'express'

declare module '@orpc/nest' {
  /**
   * Extend oRPC global context to make it type-safe inside your handlers/middlewares
   */
  interface ORPCGlobalContext {
    request: Request
  }
}

@Module({
  imports: [
    ORPCModule.forRootAsync({ // or use .forRoot for static config
      useFactory: (request: Request) => ({
        interceptors: [
          onError((error) => {
            console.error(error)
          }),
        ],
        context: { request }, // oRPC context, accessible from middlewares, etc.
        eventIteratorKeepAliveInterval: 5000, // 5 seconds
        customJsonSerializers: [],
        plugins: [
          new SmartCoercionPlugin({
            schemaConverters: [
              new ZodToJsonSchemaConverter(),
            ],
          }),
        ], // almost oRPC plugins are compatible
      }),
      inject: [REQUEST],
    }),
  ],
  controllers: [AuthController, PlanetController, ReferenceController, OtherController],
  providers: [PlanetService, ReferenceService],
})
export class AppModule {}
