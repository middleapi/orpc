import { sleep } from '@orpc/shared'
import { describe, expect, it, vi } from 'vitest'
import { createDurableObjectState } from '../tests/shared'
import { ResumeStorage } from './resume-storage'

describe('resumeStorage', () => {
  describe('constructor and options', () => {
    it.each([0, Number.NaN, Number.POSITIVE_INFINITY, -10])('is disabled when retentionSeconds is invalid', (invalidValue) => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: invalidValue })

      expect(storage.isEnabled).toBe(false)
    })
  })

  describe('store', () => {
    it('returns original string and do not create schema or alarm when disabled', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx)

      const message = JSON.stringify({ data: 'test' })
      const result = await storage.store(message)

      expect(result).toBe(message)
      expect(ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()).toEqual([])
      expect(ctx.storage.setAlarm).not.toHaveBeenCalledOnce()
    })

    it('creates schema lazily and alarm on first store', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      // Schema should not exist yet
      let tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).not.toContain('orpc:publisher:resume:events')

      await storage.store(JSON.stringify({ data: 'test' }))

      // Now schema should exist
      tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')

      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
    })

    it('stores events with auto-generated IDs', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      const result1 = await storage.store(JSON.stringify({ data: 'event1' }))
      const result2 = await storage.store(JSON.stringify({ data: 'event2' }))

      expect(JSON.parse(result1)).toEqual({ data: 'event1', meta: { id: '1' } })
      expect(JSON.parse(result2)).toEqual({ data: 'event2', meta: { id: '2' } })
    })

    it('preserves existing meta properties', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      const result = await storage.store(JSON.stringify({
        data: 'event',
        meta: { retry: 1000, comments: ['test'], id: 'should-be-overwritten' },
      }))

      expect(JSON.parse(result)).toEqual({
        data: 'event',
        meta: { retry: 1000, comments: ['test'], id: '1' },
      })
    })

    it('uses custom schema prefix', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, {
        retentionSeconds: 60,
        schemaPrefix: 'custom:prefix:',
      })

      await storage.store(JSON.stringify({ data: 'test' }))

      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('custom:prefix:events')
    })

    it('resets schema on insert error and retries', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      // First store to create schema
      await storage.store(JSON.stringify({ data: 'init' }))

      // Simulate ID near overflow by inserting a high ID
      ctx.storage.sql.exec(
        `INSERT INTO "orpc:publisher:resume:events" (id, payload) VALUES (?, ?)`,
        '9223372036854775807',
        '{"data":"old"}',
      )
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(2)

      // Next insert should trigger reset
      const result = await storage.store(JSON.stringify({ data: 'new' }))

      // Should have reset and only have the new event
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)
      expect(JSON.parse(result)).toEqual({ data: 'new', meta: { id: '1' } })

      // Should log the error before resetting
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to insert event, resetting resume storage schema.',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('getEventsAfter', () => {
    it('returns empty array and do not create schema or alarm when disabled', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx)

      const events = await storage.getEventsAfter('0')

      expect(events).toEqual([])

      expect(ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()).toEqual([])
      expect(ctx.storage.setAlarm).not.toHaveBeenCalled()
    })

    it('creates schema lazily and alarm on first getEventsAfter', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      let tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).not.toContain('orpc:publisher:resume:events')

      await storage.getEventsAfter('0')

      tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')

      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
    })

    it('returns all events after the specified ID', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage.store(JSON.stringify({ data: 'event1' }))
      await storage.store(JSON.stringify({ data: 'event2' }))
      await storage.store(JSON.stringify({ data: 'event3' }))

      const events = await storage.getEventsAfter('1')

      expect(events).toHaveLength(2)
      expect(JSON.parse(events[0]!)).toEqual({ data: 'event2', meta: { id: '2' } })
      expect(JSON.parse(events[1]!)).toEqual({ data: 'event3', meta: { id: '3' } })

      const eventsFromTwo = await storage.getEventsAfter('2')

      expect(eventsFromTwo).toHaveLength(1)
      expect(JSON.parse(eventsFromTwo[0]!)).toEqual({ data: 'event3', meta: { id: '3' } })
    })

    it('returns empty array when no events after ID', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage.store(JSON.stringify({ data: 'event1' }))
      await storage.store(JSON.stringify({ data: 'event2' }))

      const events = await storage.getEventsAfter('2')

      expect(events).toEqual([])
    })

    it('returns all events when lastEventId is 0', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage.store(JSON.stringify({ data: 'event1' }))
      await storage.store(JSON.stringify({ data: 'event2' }))

      const events = await storage.getEventsAfter('0')

      expect(events).toHaveLength(2)
    })

    it('preserves meta properties in returned events', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage.store(JSON.stringify({
        data: 'event',
        meta: { retry: 1000, comments: ['test'], id: 'should-be-overwritten' },
      }))

      const events = await storage.getEventsAfter('0')

      expect(JSON.parse(events[0]!)).toEqual({
        data: 'event',
        meta: { retry: 1000, comments: ['test'], id: '1' },
      })
    })
  })

  describe('alarm', () => {
    it('creates schema lazily and alarm on first alarm call', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      let tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).not.toContain('orpc:publisher:resume:events')

      ctx.getWebSockets.mockReturnValue([{ readyState: 1 }])
      await storage.alarm()

      tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')

      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
    })

    it('reschedules alarm when there are active websocket connections', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      ctx.getWebSockets.mockReturnValue([{ readyState: 1 }])
      ctx.storage.setAlarm.mockClear()

      await storage.alarm()

      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
      expect(ctx.storage.deleteAll).not.toHaveBeenCalled()
    })

    it('reschedules alarm when there are active events', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage.store(JSON.stringify({ data: 'event' }))
      ctx.getWebSockets.mockReturnValue([])
      ctx.storage.setAlarm.mockClear()

      await storage.alarm()

      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
      expect(ctx.storage.deleteAll).not.toHaveBeenCalled()
    })

    it('deletes all data when inactive (no connections, no events) and block other events', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 1 })

      await storage.store(JSON.stringify({ data: 'event' }))

      ctx.getWebSockets.mockReturnValue([])
      await sleep(3000) // wait for event to expire

      ctx.storage.setAlarm.mockClear()
      await storage.alarm()

      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).not.toContain('orpc:publisher:resume:events')

      expect(ctx.blockConcurrencyWhile).toHaveBeenCalledOnce()
      expect(ctx.storage.deleteAll).toHaveBeenCalledOnce()
      expect(ctx.blockConcurrencyWhile).toHaveBeenCalledBefore(ctx.storage.deleteAll)
      expect(ctx.storage.setAlarm).not.toHaveBeenCalled()
    })

    it('resets initialization flags after deleteAll', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 1 })

      await storage.store(JSON.stringify({ data: 'event' }))
      ctx.getWebSockets.mockReturnValue([])
      await sleep(3000)

      await storage.alarm()

      let tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).not.toContain('orpc:publisher:resume:events')

      // Schema and alarm should be recreated on next store
      ctx.storage.setAlarm.mockClear()
      await storage.store(JSON.stringify({ data: 'new-event' }))

      tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')
      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
    })

    it('uses custom inactiveDataRetentionTime for alarm scheduling', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, {
        retentionSeconds: 60,
        inactiveDataRetentionTime: 120,
      })

      await storage.store(JSON.stringify({ data: 'test' }))

      // Alarm should be scheduled at retentionSeconds + inactiveDataRetentionTime
      expect(ctx.storage.setAlarm).toHaveBeenCalledWith(
        expect.any(Number),
      )

      const alarmTime = ctx.storage.setAlarm.mock.calls[0]![0]
      const expectedDelay = (60 + 120) * 1000
      expect(alarmTime).toBeGreaterThanOrEqual(Date.now() + expectedDelay - 1000)
      expect(alarmTime).toBeLessThanOrEqual(Date.now() + expectedDelay + 1000)
    })
  })

  describe('schema & alarm initialization', () => {
    it('should not create schema if setAlarm throws error', async () => {
      const ctx = createDurableObjectState()
      ctx.storage.setAlarm.mockRejectedValue(new Error('Alarm scheduling failed'))

      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await expect(storage.store(JSON.stringify({ data: 'event1' }))).rejects.toThrow('Alarm scheduling failed')
      await expect(storage.getEventsAfter('0')).rejects.toThrow('Alarm scheduling failed')

      // Schema should not init because alarm scheduling failed
      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).not.toContain('orpc:publisher:resume:events')

      expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(2)
    })

    it('should not schedule alarm if one is already scheduled', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      // Simulate an alarm already scheduled from a previous DO session
      ctx.storage.getAlarm.mockReturnValue(Date.now() + 60000)

      await storage.store(JSON.stringify({ data: 'event1' }))
      await storage.store(JSON.stringify({ data: 'event2' }))
      await storage.getEventsAfter('0')

      // Schema should exist
      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')

      // setAlarm should not have been called since alarm is already scheduled
      expect(ctx.storage.setAlarm).not.toHaveBeenCalled()
      // getAlarm should have been called to check existing alarm
      expect(ctx.storage.getAlarm).toHaveBeenCalledOnce()
    })

    it('should only initialize schema and alarm once', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 1 })

      // Multiple operations should only create schema and set alarm once
      await storage.store(JSON.stringify({ data: 'event1' }))
      await storage.store(JSON.stringify({ data: 'event2' }))
      await storage.getEventsAfter('0')

      // Schema should exist
      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')

      // setAlarm should only have been called once during initialization
      expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1)
    })

    it('creates indexes for id and stored_at', async () => {
      const ctx = createDurableObjectState()
      const storage = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage.store(JSON.stringify({ data: 'test' }))

      const indexes = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'index').toArray()
      const indexNames = indexes.map((i: any) => i.name)

      expect(indexNames).toContain('orpc:publisher:resume:idx_events_id')
      expect(indexNames).toContain('orpc:publisher:resume:idx_events_stored_at')
    })

    it('handles schema already exists (idempotent)', async () => {
      const ctx = createDurableObjectState()
      const storage1 = new ResumeStorage(ctx, { retentionSeconds: 60 })
      const storage2 = new ResumeStorage(ctx, { retentionSeconds: 60 })

      await storage1.store(JSON.stringify({ data: 'test1' }))
      await storage2.store(JSON.stringify({ data: 'test2' }))

      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(2)
    })
  })

  describe('cleanup expired events', () => {
    it('cleans up expired events during store/getEventsAfter/alarm', { timeout: 20_000, retry: 3 }, async () => {
      const ctx = createDurableObjectState()
      const storage1 = new ResumeStorage(ctx, { retentionSeconds: 1 })
      const storage2 = new ResumeStorage(ctx, { retentionSeconds: 1 })
      // ensure ctx is active
      ctx.getWebSockets.mockReturnValue([{ readyState: 1 }])

      await storage1.store(JSON.stringify({ data: 'event1' }))
      await storage2.store(JSON.stringify({ data: 'event2' }))
      // Both events should be stored
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(2)

      await sleep(2100) // wait for event to expire
      await storage1.store(JSON.stringify({ data: 'event2' }))
      // First event should be expired, only second remains
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)

      await sleep(2100) // wait for event to expire
      const storage3 = new ResumeStorage(ctx, { retentionSeconds: 1 })
      await storage3.getEventsAfter('0')
      // All previous events should be expired
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(0)

      await storage3.store(JSON.stringify({ data: 'event3' }))
      // New event should be stored correctly
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)

      await sleep(2100) // wait for event to expire
      await storage3.alarm()
      // All previous events should be expired
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(0)

      await storage1.store(JSON.stringify({ data: 'event4' }))
      // New event should be stored correctly
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)

      await sleep(2100) // wait for event to expire
      const storage4 = new ResumeStorage(ctx, { retentionSeconds: 2 })
      await storage4.alarm()
      // event4 shouldn't be expired yet because retentionSeconds is now 2
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)

      await sleep(2100) // wait for event to expire
      await storage4.alarm()
      // now event4 should be expired
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(0)
    })
  })
})
