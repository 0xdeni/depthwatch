/**
 * What a static build knew, when it was built, of the bundle it ships: whether that bundle lists
 * a mandate and whether it is a live snapshot. A page drawn while the bundle is still loading uses
 * them to take, from its first frame, the shape it keeps once the data is in (the nav's tabs,
 * Home's previews, the scorecards page), as the header in index.html does.
 * `plugins/siteMeta.ts` writes both through Vite's `define`. A server build knows neither in
 * advance, so both read as undefined there.
 */

/** Whether the shipped bundle lists at least one mandate; undefined outside a static build. */
export function shippedMandates(): boolean | undefined {
  const count: unknown = import.meta.env.DW_SHIPPED_MANDATES
  return typeof count === 'string' ? count !== '0' : undefined
}

/** Whether the shipped bundle is a live snapshot; undefined outside a static build. */
export function shippedSnapshot(): boolean | undefined {
  const source: unknown = import.meta.env.DW_SHIPPED_SOURCE
  return typeof source === 'string' ? source === 'live' : undefined
}
