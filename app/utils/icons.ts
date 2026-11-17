// The AAS icon of the BaSyx AAS Web UI (aas-web-ui/src/assets/Icons/AASIcon.vue),
// © the Eclipse BaSyx Authors, MIT License. Its paths are scaled from the
// original 90×90 view box to Vuetify's 24×24, so it works as an SVG icon alias
// (`$aas`, registered in app/plugins/vuetify-icons.ts).
export const aasIconPaths = [
  'M18.533 13.253c-1.493 0 -2.4 -0.747 -2.4 -2.027h1.68c0 0.507 0.24 0.747 0.773 0.747s0.667 -0.187 0.667 -0.507 -0.267 -0.453 -0.987 -0.64c-1.067 -0.293 -2.027 -0.613 -2.027 -1.867s0.853 -1.84 2.293 -1.84 2.24 0.64 2.24 1.92h-1.627c0 -0.427 -0.24 -0.667 -0.693 -0.667s-0.613 0.187 -0.613 0.453 0.267 0.427 1.013 0.613c1.093 0.267 2.053 0.613 2.053 1.92 0 1.173 -0.907 1.893 -2.373 1.893M13.387 13.12l-0.293 -1.067h-1.867l-0.293 1.067h-1.653l1.867 -5.867h2l1.867 5.867h-1.627ZM6.747 13.12l-0.293 -1.067h-1.867l-0.293 1.067h-1.627l1.867 -5.867h2l1.867 5.867h-1.653ZM23.707 6.96l-1.733 -1.92c-0.213 -0.213 -0.48 -0.347 -0.8 -0.347H2.8c-0.293 0 -0.587 0.133 -0.8 0.347l-1.733 1.92c-0.16 0.213 -0.267 0.48 -0.267 0.747v11.04c0 0.613 0.48 1.093 1.067 1.093h0.72c0.587 0 1.067 -0.507 1.067 -1.093v-1.467c0 -0.267 0.107 -0.533 0.293 -0.747l0.747 -0.827c0.213 -0.24 0.48 -0.347 0.8 -0.347h14.587c0.293 0 0.56 0.107 0.747 0.32l0.853 0.853c0.213 0.213 0.32 0.48 0.32 0.773v1.413c0 0.613 0.48 1.093 1.067 1.093h0.667c0.587 0 1.067 -0.507 1.067 -1.093V7.707c0 -0.267 -0.107 -0.533 -0.293 -0.747',
  'M12.187 8.4c-0.16 0.64 -0.32 1.333 -0.507 1.973l-0.107 0.4h1.2l-0.107 -0.4c-0.187 -0.64 -0.347 -1.333 -0.48 -1.973',
  'M5.547 8.4c-0.16 0.64 -0.32 1.333 -0.507 1.973l-0.107 0.4h1.2l-0.107 -0.4c-0.16 -0.64 -0.347 -1.333 -0.48 -1.973',
]

// The toggle of the side list (shells, submodels) in the desktop title bar,
// outlined like the other title bar icons, as VS Code's "toggle primary side
// bar": a rounded frame with the left panel marked off by a line while the
// list is closed (`$sidebar`) and filled while it is open (`$sidebarOpen`).
// Material Design Icons has it only filled (`mdi-dock-left`). The frame's
// inner edge runs the other way, so it cuts out of the outer one.
const sidebarFrame = 'M5 4H19A3 3 0 0 1 22 7V17A3 3 0 0 1 19 20H5A3 3 0 0 1 2 17V7A3 3 0 0 1 5 4ZM5 6A1 1 0 0 0 4 7V17A1 1 0 0 0 5 18H19A1 1 0 0 0 20 17V7A1 1 0 0 0 19 6Z'
export const sidebarIconPath = `svg:${sidebarFrame}M8 6H10V18H8Z`
export const sidebarOpenIconPath = `svg:${sidebarFrame}M5 6A1 1 0 0 0 4 7V17A1 1 0 0 0 5 18H10V6Z`
