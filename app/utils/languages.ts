/** Languages offered for language strings: code and name; any other code can be typed. */
export const languages: ReadonlyArray<{ code: string, name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
]

/** The idShort rule of AAS 3.1: a letter first, then letters, digits, `-` or `_`, not ending with `-`. */
export const idShortPattern = /^[A-Z][\w-]*\w$/i

export const categories: readonly string[] = ['CONSTANT', 'PARAMETER', 'VARIABLE']

/** Messages of AAS Core findings whose path is `field` or below it. */
export function errorsFor (violations: ReadonlyArray<{ path: string, message: string }>, field: string): string[] {
  const clean = (path: string) => path.replace(/^[/.]+/, '')
  return violations
    .filter(violation => {
      const path = clean(violation.path)
      return path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`) || path.startsWith(`${field}/`)
    })
    .map(violation => violation.message)
}

/** Findings that no field of the form claims, shown together under the form. */
export function unclaimed (violations: ReadonlyArray<{ path: string, message: string }>, fields: readonly string[]): Array<{ path: string, message: string }> {
  return violations.filter(violation => fields.every(field => errorsFor([violation], field).length === 0))
}
