import { nowInSeconds } from './time'

describe('nowInSeconds', () => {
  it('floors the current time to whole seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1999)

    expect(nowInSeconds()).toBe(1)

    vi.useRealTimers()
  })
})
