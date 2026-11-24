import { useDisplay, useRtl } from 'vuetify'
import { panelRadius } from '#shared/window-panel'

/** Which ends of a part of the panel meet something: the window's frame, or another part. */
export interface PanelEnds {
  start: boolean
  end: boolean
}

/** A part's `rounded` and `border` props. */
export interface PanelLook {
  rounded: string | 0
  border: string
}

/**
 * The page's panel (shared/window-panel.ts), made of the page
 * (WindowContent) and the drawers beside it, inset in the frame that the
 * app bar, the rail and the frame's 4 px end and bottom edges form. Each
 * part is rounded where it meets the frame, concentric with the window's
 * corners, and bordered there by a thin line, as the coding agents' own
 * apps; between two parts, one of them draws the line.
 *
 * The desktop app's window is always framed. A browser is framed while it
 * shows the rail, from `md` up and after login; its panel takes the corners
 * of a window with a 12 px radius. On phones and the login page the parts
 * keep their own borders and no corners, and `look` is null.
 */
export function useWindowPanel () {
  const desktop = useDesktopBridge()
  const session = useSessionStore()
  const { mdAndUp } = useDisplay()
  const { isRtl } = useRtl()
  const radius = `${panelRadius(desktop?.windowCornerRadius ?? 12)}px`
  /** Studio is drawn as a frame around an inset panel (the same condition as the rail's in the browser). */
  const framed = computed(() => desktop !== null || (mdAndUp.value && !session.needsLogin))

  /** The look of a part whose ends meet the frame, with a line also towards the parts it divides from. */
  function look (frame: PanelEnds, divides: Partial<PanelEnds> = {}): PanelLook | null {
    if (!framed.value) {
      return null
    }
    // A radius per corner (top left, top right, bottom right, bottom left); Vuetify has no class for it.
    const [left, right] = isRtl.value ? [frame.end, frame.start] : [frame.start, frame.end]
    const corner = (round: boolean) => (round ? radius : '0')
    return {
      rounded: left || right ? `${corner(left)} ${corner(right)} ${corner(right)} ${corner(left)}` : 0,
      border: ['t', 'b', frame.start || divides.start ? 's' : '', frame.end || divides.end ? 'e' : ''].filter(Boolean).join(' '),
    }
  }

  return { inDesktopWindow: desktop !== null, framed, look }
}
