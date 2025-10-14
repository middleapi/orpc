import { useEffect, useRef } from 'react'
import { getWorkerClient } from '~/lib/worker-client'

export function WebWorker() {
  const canvasRef = useRef<HTMLCanvasElement>(null!)

  useEffect(() => {
    const worker = getWorkerClient()
    worker.buffer({ buffer: new Uint8Array([1, 2, 3, 4, 5]) })

    const offscreen = canvasRef.current.transferControlToOffscreen()
    worker.render({ canvas: offscreen }, { transfer: [offscreen] })
  }, [])

  return (
    <div>
      <h2>oRPC | Web Worker example</h2>
      <canvas ref={canvasRef} />
    </div>
  )
}
