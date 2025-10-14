import { os, type } from '@orpc/server'
import { RPCHandler } from '@orpc/server/message-port'

const buffer = os.input(type<{ buffer: Uint8Array }>()).handler(({ input }) => {
  console.log(input.buffer)
})

const render = os.input(type<{ canvas: OffscreenCanvas }>()).handler(({ input }) => {
  const ctx = input.canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas')
  }

  ctx.fillStyle = 'green'

  const circle = new AnimatedCircle(ctx)
  circle.boundAnimate()
})

class AnimatedCircle {
  ctx: OffscreenCanvasRenderingContext2D
  x: number
  y: number
  radius: number
  maxRadius: number
  grow: boolean
  boundAnimate: () => void

  constructor(ctx: OffscreenCanvasRenderingContext2D) {
    this.ctx = ctx
    this.x = ctx.canvas.width / 2
    this.y = ctx.canvas.height / 2
    this.radius = 24
    this.maxRadius = 36
    this.grow = true
    this.boundAnimate = this.animate.bind(this)
  }

  draw() {
    this.ctx.beginPath()
    this.ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI, false)
    this.ctx.fill()
  }

  animate() {
    if (this.radius === this.maxRadius || this.radius === 0) {
      this.grow = !this.grow
    }

    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
    this.draw()
    this.radius = this.grow ? this.radius + 1 : this.radius - 1
    requestAnimationFrame(this.boundAnimate)
  }
}

export const router = {
  buffer,
  render,
}

const handler = new RPCHandler(router)

handler.upgrade(globalThis as any, {
  context: {},
})
