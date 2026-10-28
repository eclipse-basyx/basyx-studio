import { buttonGroupDefaults, fieldDefaults, fullscreenDefaults, layoutDefaults, menuDefaults } from './vuetify-defaults.ts'

// Vuetify defaults of Studio's apps (ADR 0023, ADR 0043). They follow
// Studio's look: a view renders flat inside the card Studio gives it (an
// Overview widget, the details drawer, the full-screen dialog), which
// already has the border, the radius and the view's title. Without Vue or
// Vuetify imports, so ESLint checks the apps' templates against them, as it
// checks Studio's against vuetify.config.ts.

export const appDefaults = {
  // Studio's card shows through: the frame's page and the view have no background of their own.
  VApp: { class: 'bg-transparent' },
  VViewCard: { flat: true, border: false, rounded: 0, color: 'transparent' },
  VCard: { flat: true, border: true, rounded: 'lg' },
  // The header of a dialog's or section's card, as in Studio: a tinted band
  // that sets the title apart from the content.
  VCardHeader: { class: 'bg-card-header' },
  // A part of a view in a card of its own (a nameplate's product, its
  // manufacturer), bordered as every card and as tall as its neighbours in a
  // row; its label and value rows sit flush, the card is their border, and
  // their stripes start on the second row, so the first one does not look
  // like the tinted header above it. An alias takes none of VCard's
  // defaults, so they are restated.
  VCardSection: { flat: true, border: true, rounded: 'lg', class: 'h-100 d-flex flex-column', VTableDetails: { class: 'bg-transparent', striped: 'even' } },
  // Dialogs as in Studio: their card keeps a shadow, so it stands out.
  VDialog: { VCard: { flat: false } },
  // The actions of a dialog or card at Studio's button height: the view's
  // buttons are comfortable (VBtn below), Studio's dialog buttons are not.
  VCardActions: { VBtn: { density: 'default' }, VBtnPrimary: { density: 'default' }, VBtnSecondary: { density: 'default' } },
  // A view that fills the window, e.g. a preview opened without Studio's header.
  ...fullscreenDefaults,
  VBtn: { rounded: 'lg', class: 'text-none', variant: 'text', density: 'comfortable' },
  VBtnPrimary: { color: 'primary', variant: 'flat', rounded: 'lg', class: 'text-none', density: 'comfortable' },
  VBtnSecondary: { color: 'surface-light', variant: 'flat', border: true, rounded: 'lg', class: 'text-none', density: 'comfortable' },
  // A value that opens something (a link, an email address, a phone number, a
  // document): in the primary colour, so it stands out from plain values.
  // Flush with the text before it; 4 px after it, as Vuetify pulls an
  // appended icon 3 px outwards and the button clips what overflows.
  VBtnLink: { color: 'primary', variant: 'text', size: 'small', rounded: 'lg', class: 'ps-0 pe-1 text-none text-break', density: 'comfortable' },
  ...buttonGroupDefaults,
  ...fieldDefaults,
  VChip: { label: true, size: 'small', variant: 'tonal' },
  VList: { density: 'compact', bgColor: 'transparent' },
  VListItem: { rounded: 'lg' },
  // Menus as in Studio.
  ...menuDefaults,
  // The app bar, drawers, toolbars and tabs of a full-page module, as in Studio.
  ...layoutDefaults,
  // Label and value rows of a view (a nameplate's facts, a document's
  // details): bordered with Studio's radius, every other row tinted, as in
  // the BaSyx AAS Web UI.
  VTableDetails: { density: 'compact', striped: 'odd', class: 'bg-transparent border rounded-lg overflow-hidden' },
  // A table with column headers and group rows (a technical data sheet):
  // bordered as the details, not striped, so the tinted header and group
  // rows stand out, and the row under the pointer highlighted, as the BaSyx
  // AAS Web UI's table view.
  VTableSheet: { density: 'compact', hover: true, class: 'bg-transparent border rounded-lg overflow-hidden' },
  // A search over what a view shows (a data sheet's properties), as Studio's
  // search over its shell list: an outlined field, compact, with the
  // magnifier and a button to clear it. An alias takes none of VTextField's
  // defaults, so the shared field look is restated.
  VTextFieldSearch: { ...fieldDefaults.VTextField, density: 'compact', hideDetails: true, clearable: true, prependInnerIcon: 'mdi-magnify' },
  // Collapsed details (a nameplate's asset specific properties, a model's
  // technical details): bordered as cards, without a shadow.
  VExpansionPanels: { flat: true, class: 'border rounded-lg overflow-hidden' },
  VAlert: { border: 'start', variant: 'tonal' },
  VProgressLinear: { indeterminate: true, color: 'primary' },
} as const
