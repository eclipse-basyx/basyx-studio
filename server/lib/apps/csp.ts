/**
 * The Content Security Policy of every app file (ADR 0017). `base` is the
 * installation's own URL prefix, so scripts, styles and other resources can
 * only come from the app's package; nothing can be fetched from Studio or
 * elsewhere. `sandbox` keeps the document in an opaque origin even when it
 * is opened outside Studio's iframe.
 */
export function appContentSecurityPolicy (base: string, frameAncestors: Iterable<string>): string {
  return [
    `default-src 'none'`,
    `script-src ${base}`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base}`,
    `media-src ${base} blob:`,
    `connect-src ${base}`,
    `frame-src 'none'`,
    `worker-src 'none'`,
    `object-src 'none'`,
    `form-action 'none'`,
    `base-uri 'none'`,
    `frame-ancestors ${[...frameAncestors].join(' ')}`,
    'sandbox allow-scripts',
  ].join('; ')
}
