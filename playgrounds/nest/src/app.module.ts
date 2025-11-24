import { Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller'
import { PlanetController } from './planet/planet.controller'
import { OtherController } from './other/other.controller'
import { PlanetService } from './planet/planet.service'
import { ReferenceController } from './reference/reference.controller'
import { ReferenceService } from './reference/reference.service'
import { onError, ORPCModule } from '@orpc/nest'
import { experimental_SmartCoercionPlugin as SmartCoercionPlugin } from '@orpc/json-schema'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

declare module '@orpc/nest' {
  interface ORPCGlobalContext {
    someCustomContext?: string
  }
}

@Module({
  imports: [
    ORPCModule.forRoot({
      eventIteratorKeepAliveInterval: 5000, // 5 seconds
      context: { someCustomContext: 'Hello, World!' },
      interceptors: [
        onError((error) => {
          console.error(error)
        }),
      ],
      plugins: [
        new SmartCoercionPlugin({
          schemaConverters: [
            new ZodToJsonSchemaConverter(),
          ],
        }),
      ],
    }),
  ],
  controllers: [AuthController, PlanetController, ReferenceController, OtherController],
  providers: [PlanetService, ReferenceService],
})
export class AppModule {}
