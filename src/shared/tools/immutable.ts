/** Keep execution metadata and scoped descriptors independent of mutable registration/config objects. */
export function frozenCopy<T>(input: T): T {
  function freeze(value: unknown): void {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  }
  const copy = structuredClone(input)
  freeze(copy)
  return copy
}
