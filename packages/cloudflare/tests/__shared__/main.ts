import { DurablePublisherObject } from '../../src/publisher-object'

export class PublisherDO extends DurablePublisherObject {
}

export class PublisherReplay3sDO extends DurablePublisherObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      replay: {
        enabled: true,
        seconds: 3,
        cleanupIntervalSeconds: 30,
        schemaPrefix: 'prefix:',
      },
    })
  }
}
