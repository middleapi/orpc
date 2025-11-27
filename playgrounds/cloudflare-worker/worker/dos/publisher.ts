import { PublisherDurableObject } from '@orpc/experimental-publisher-durable-object'

export class PublisherDO extends PublisherDurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      resume: {
        retentionSeconds: 60 * 2, // Retain events for 2 minutes to support resume
      },
    })
  }
}
