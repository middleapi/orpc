import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from './message-port'

describe('postMessagePortMessage', () => {
  it('calls postMessage on the port', () => {
    const mockPort = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    }
    const data = 'hello'
    postMessagePortMessage(mockPort, data)
    expect(mockPort.postMessage).toBeCalledTimes(1)
    expect(mockPort.postMessage).toHaveBeenCalledWith(data)
  })

  it('calls postMessage on the port with transfer', () => {
    const mockPort = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    }
    const data = new Uint8Array([1, 2, 3])
    const transfer = [data.buffer]
    postMessagePortMessage(mockPort, data, transfer)
    expect(mockPort.postMessage).toBeCalledTimes(1)
    expect(mockPort.postMessage).toHaveBeenCalledWith(data, transfer)
  })
})

describe('onMessagePortMessage', () => {
  it('uses addEventListener if available', () => {
    const port = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortMessage(port, callback)

    expect(port.addEventListener).toBeCalledTimes(1)
    const [event, handler] = port.addEventListener.mock.calls[0]!
    expect(event).toBe('message')

    handler({ data: 'test-data' })
    expect(callback).toHaveBeenCalledWith('test-data')
  })

  it('uses on if available', () => {
    const port = {
      on: vi.fn(),
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortMessage(port, callback)

    expect(port.on).toBeCalledTimes(1)
    const [event, handler] = port.on.mock.calls[0]!
    expect(event).toBe('message')

    handler({ data: 'test-data' })
    expect(callback).toHaveBeenCalledWith('test-data')
  })

  it('uses onMessage if available', () => {
    const port = {
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortMessage(port, callback)

    expect(port.onMessage.addListener).toBeCalledTimes(1)
    const listener = port.onMessage.addListener.mock.calls[0]![0]

    listener('test-data')
    expect(callback).toHaveBeenCalledWith('test-data')
  })

  it('prefer addEventListener over on', () => {
    const port = {
      on: vi.fn(),
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortMessage(port, callback)

    expect(port.on).toBeCalledTimes(0)
    expect(port.addEventListener).toBeCalledTimes(1)
    const [event, handler] = port.addEventListener.mock.calls[0]!
    expect(event).toBe('message')

    handler({ data: 'test-data' })
    expect(callback).toHaveBeenCalledWith('test-data')
  })

  it('throws if invalid port', () => {
    expect(() => onMessagePortMessage({} as any, () => {})).toThrowError()
  })
})

describe('onMessagePortClose', () => {
  it('uses addEventListener if available', () => {
    const port = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortClose(port, callback)

    expect(port.addEventListener).toBeCalledTimes(1)
    const [event, handler] = port.addEventListener.mock.calls[0]!
    expect(event).toBe('close')

    handler()
    expect(callback).toHaveBeenCalled()
  })

  it('uses on if available', () => {
    const port = {
      on: vi.fn(),
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortClose(port, callback)

    expect(port.on).toBeCalledTimes(1)
    const [event, handler] = port.on.mock.calls[0]!
    expect(event).toBe('close')

    handler({})
    expect(callback).toHaveBeenCalled()
  })

  it('uses onDisconnect if available', () => {
    const port = {
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortClose(port, callback)

    expect(port.onDisconnect.addListener).toBeCalledTimes(1)
    const listener = port.onDisconnect.addListener.mock.calls[0]![0]

    listener()
    expect(callback).toHaveBeenCalled()
  })

  it('prefer addEventListener over on', () => {
    const port = {
      on: vi.fn(),
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    }

    const callback = vi.fn()
    onMessagePortClose(port, callback)

    expect(port.on).toBeCalledTimes(0)
    expect(port.addEventListener).toBeCalledTimes(1)
    const [event, handler] = port.addEventListener.mock.calls[0]!
    expect(event).toBe('close')

    handler({})
    expect(callback).toHaveBeenCalled()
  })

  it('throws if invalid port', () => {
    expect(() => onMessagePortClose({} as any, () => {})).toThrowError()
  })
})
