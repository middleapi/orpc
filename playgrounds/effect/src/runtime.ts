import { ManagedRuntime } from 'effect'
import { PlanetRepo } from './services'

/**
 * Builds every layer once and keeps the resulting services alive for the
 * lifetime of the server. Call `runtime.dispose()` on shutdown to release them.
 */
export const runtime = ManagedRuntime.make(PlanetRepo.layer)
