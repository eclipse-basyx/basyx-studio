/**
 * The vue-i18n plural rule for a BCP 47 language (ADR 0026). The number of
 * choices in a message has one meaning in every locale:
 *
 * - 1 choice: always that text (Chinese, Japanese),
 * - 2 choices: `one | other`,
 * - 3 choices: `zero | one | other`.
 *
 * `Intl.PluralRules` decides between `one` and `other`, so French gets
 * "0 résultat", which vue-i18n's default rule would make plural.
 */
export function pluralRule (language: string): (choice: number, choicesLength: number) => number {
  const rules = new Intl.PluralRules(language)
  return (choice, choicesLength) => {
    if (choicesLength <= 1) {
      return 0
    }
    const count = Math.abs(choice)
    if (choicesLength >= 3 && count === 0) {
      return 0
    }
    const one = choicesLength >= 3 ? 1 : 0
    return rules.select(count) === 'one' ? one : one + 1
  }
}
