/** Coalesce metadata requests, bound memory, and retry missing metadata after 30s. */
export class RequestCache<T> {
  private values = new Map<string, { value: T; expires: number }>()
  private pending = new Map<string, Promise<T>>()
  private generation = 0

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly emptyTtlMs = 30_000,
    private readonly maxEntries = 256,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key)
    if (cached && cached.expires > this.now()) return Promise.resolve(cached.value)
    this.values.delete(key)
    const existing = this.pending.get(key)
    if (existing) return existing
    const generation = this.generation
    const request = Promise.resolve().then(load).then(value => {
      if (generation === this.generation) {
        this.values.delete(key)
        this.values.set(key, { value, expires: this.now() + (value ? this.ttlMs : this.emptyTtlMs) })
        while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value!)
      }
      return value
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key)
    })
    this.pending.set(key, request)
    return request
  }

  clear(): void {
    this.generation++
    this.values.clear()
    this.pending.clear()
  }
}
