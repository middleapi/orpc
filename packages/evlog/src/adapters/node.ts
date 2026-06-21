import type { StandardRequest } from '@standardserver/core'
import type { RequestLogger } from 'evlog'
import type { FrameworkIntegrationSpec } from 'evlog/toolkit'
import { createLoggerStorage as baseCreateLoggerStorage } from 'evlog/toolkit'

export function createLoggerStorage(): {
  storage: FrameworkIntegrationSpec<{ request: StandardRequest }>['storage']
  useLogger: () => Required<RequestLogger>
} {
  return baseCreateLoggerStorage(
    'please configure EvlogHandlerPlugin for your handler using the created storage',
  ) as any
}
