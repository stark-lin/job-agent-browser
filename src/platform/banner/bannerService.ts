import type { BannerEvent } from '../../shared/banner'

export class BannerService {
  private last = 0n
  private clock = 0n
  private current: BannerEvent | null = null
  private timer?: ReturnType<typeof setTimeout>
  private render?: (event: BannerEvent | null) => void

  nextTime(): string {
    const now = BigInt(Date.now()) * 1000n
    this.clock = now > this.clock ? now : this.clock + 1n
    return this.clock.toString()
  }

  attach(render: (event: BannerEvent | null) => void): () => void {
    this.render = render
    render(this.current)
    return () => {
      if (this.render !== render) return
      this.render = undefined
      this.dismiss()
    }
  }

  publish(event: BannerEvent): void {
    if (!/^[0-9]{1,24}$/.test(event.timeUs)) return
    const time = BigInt(event.timeUs)
    if (time < this.last || time === this.last && !this.current) return
    this.last = time
    if (time > this.clock) this.clock = time
    this.current = event
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.current === event) this.dismiss(event.timeUs)
    }, 5000)
    this.timer.unref()
    this.render?.(event)
  }

  action(timeUs: string): BannerEvent['action'] {
    return this.current?.timeUs === timeUs ? this.current.action : undefined
  }

  dismiss(timeUs?: string): void {
    if (timeUs !== undefined && this.current?.timeUs !== timeUs) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.current = null
    this.render?.(null)
  }
}
