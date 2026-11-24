// Vuetify defaults that Studio (vuetify.config.ts) and its apps
// (./defaults.ts) share, so controls look the same in both. Studio imports
// them from this package (ADR 0043).

/** Text fields, selects and the like: outlined, 36 px tall with Studio's Sass settings. */
const field = { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' } as const

export const fieldDefaults = {
  VTextField: field,
  VSelect: field,
  VAutocomplete: field,
  VCombobox: field,
  VFileInput: field,
  VTextarea: field,
  VCheckbox: { density: 'compact', color: 'primary', hideDetails: 'auto' },
  VSwitch: { color: 'primary', inset: true, hideDetails: true, density: 'compact' },
} as const

/*
 * Grouped buttons: a bordered, divided group of text buttons with square
 * inner corners. Templates use a bare <v-btn-toggle> (one choice of several)
 * or <v-btn-group> (related actions or menus) and style neither the group
 * nor its buttons; ESLint refuses it. An icon-only choice in a toggle is a
 * <v-btn-toggle-icon> (alias of VBtn): the toggle hands its compact density
 * to every v-btn, which squeezes an icon button to 28 px around a 24 px
 * icon; the alias reads only its own defaults, which keep room around a
 * smaller icon.
 */

export const buttonGroupDefaults = {
  VBtnToggle: { density: 'compact', rounded: 'lg', color: 'primary', border: true, divided: true, variant: 'text', VBtn: { rounded: false } },
  VBtnGroup: { density: 'compact', rounded: 'lg', border: true, divided: true, variant: 'text', VBtn: { rounded: false } },
  // As the group's own buttons (the group sets height, flat and the rest).
  VBtnToggleIcon: { color: 'primary', variant: 'text', flat: true, height: 'auto', rounded: false, density: 'comfortable', VIcon: { size: 'small' } },
} as const

/*
 * Menus are dense, as in shadcn: compact rows, slim icons, body-sized text.
 * Items are inset evenly (pa-1) with a smaller radius (4 px) than the menu
 * card (8 px), so their highlight follows the card's corners. Lists are
 * transparent elsewhere; the menus of selects, comboboxes and autocompletes
 * have no card around their list, so it brings the surface. Every menu looks
 * the same, with or without a card around its list: a bare list brings the
 * card's border, radius and shadow itself; inside a card (as Studio's
 * account menu) the card has them. Templates use a bare <v-list> of
 * <v-list-item>s in a <v-menu> and style neither; ESLint refuses it.
 */
export const menuDefaults = {
  VMenu: {
    VCard: { flat: false, VList: { border: false, rounded: 0, elevation: 0 } },
    VList: { density: 'compact', slim: true, bgColor: 'surface', class: 'pa-1 text-body-medium', border: true, rounded: 'lg', elevation: 1 },
    VListItem: { minHeight: 36, rounded: true },
    // A menu's search is its header: lower than a dialog's or the command palette's.
    VTextField: { density: 'compact' },
  },
} as const

/** Props that style a menu's list or items; the menu defaults above set them, never a template. */
export const menuStyleProps = ['density', 'slim', 'bg-color', 'border', 'rounded', 'elevation', 'min-height', 'nav'] as const

/*
 * The layout of a page: a flat app bar and drawers divided from the content
 * by a border, as Studio's own; toolbars inside the page (a pane's or a
 * module's bar of its pages) are compact and show the surface behind them;
 * tabs in the primary color. A full-page module (ADR 0045) builds its pages
 * from them and states none of these props.
 */
export const layoutDefaults = {
  // The app bar is a VToolbar and would take the toolbars' transparency;
  // `surface` is the background its own styles give it.
  VAppBar: { flat: true, border: 'b', density: 'comfortable', color: 'surface' },
  VNavigationDrawer: { border: 'e' },
  VToolbar: { color: 'transparent', density: 'compact' },
  VTabs: { color: 'primary', density: 'comfortable' },
} as const

/*
 * Full-screen surfaces:the card of a full-screen dialog, or an app's view
 * that fills the window (a preview opened with `header: false`), runs edge
 * to edge, so it has no border and no radius. Use <v-card-fullscreen>
 * (alias of VCard) for it, never a plain <v-card>, which brings a card's
 * border and radius; ESLint refuses a <v-card> in a full-screen <v-dialog>.
 */
export const fullscreenDefaults = {
  VCardFullscreen: { flat: true, border: false, rounded: 0 },
} as const

/** Props that style a group; set them in the defaults above, never in a template. */
export const buttonGroupStyleProps = ['variant', 'color', 'base-color', 'density', 'rounded', 'tile', 'border', 'divided', 'elevation', 'size'] as const

const roundedField = { rounded: 'xl' } as const

/**
 * The `rounded` shape of Studio's appearance settings (ADR 0055): large
 * radii, pill-shaped buttons and chips. Laid over the defaults above by
 * Studio (shared/appearance.ts) and by apps when Studio's theme says
 * `shape: 'rounded'` (mountApp); only radii change.
 */
export const roundedShapeDefaults = {
  VBtn: { rounded: 'pill' },
  VBtnPrimary: { rounded: 'pill' },
  VBtnSecondary: { rounded: 'pill' },
  VBtnToggle: { rounded: 'pill' },
  VCard: { rounded: 'xl' },
  VAvatar: { rounded: 'xl' },
  VListItem: { rounded: 'xl' },
  VChip: { label: false },
  VAlert: { rounded: 'xl' },
  VTextField: roundedField,
  VSelect: roundedField,
  VAutocomplete: roundedField,
  VCombobox: roundedField,
  VFileInput: roundedField,
  VTextarea: roundedField,
  VDialog: { VCard: { rounded: 'xl' } },
  // Menu items stay a step smaller than their menu, as in the normal shape.
  VMenu: { VCard: { rounded: 'xl' }, VList: { rounded: 'xl' }, VListItem: { rounded: 'lg' } },
}

type Defaults = Record<string, unknown>

/** Lays a shape's defaults over others, component by component and into nested ones. */
export function withShape (base: Defaults, shape: Defaults): Defaults {
  const result: Defaults = { ...base }
  for (const [component, values] of Object.entries(shape)) {
    const current = result[component]
    result[component] = current && typeof current === 'object' && values && typeof values === 'object'
      ? withShape(current as Defaults, values as Defaults)
      : values
  }
  return result
}
