import { useRtl } from 'vuetify'
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
 * The page's panel in the desktop window (shared/window-panel.ts), made of
 * the page (WindowContent) and the drawers beside it. Each part is rounded
 * where it meets the frame, concentric with the window's corners, and
 * bordered there by a thin line, as the coding agents' own apps; between
 * two parts, one of them draws the line. `look` is null in a browser, where
 * the parts keep their own borders and no corners.
 */
export function useWindowPanel () {
  const desktop = useDesktopBridge()
  const { isRtl } = useRtl()
  const radius = desktop ? `${panelRadius(desktop.windowCornerRadius ?? 12)}px` : '0'

  /** The look of a part whose ends meet the frame, with a line also towards the parts it divides from. */
  function look (frame: PanelEnds, divides: Partial<PanelEnds> = {}): PanelLook | null {
    if (!desktop) {
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

  return { inDesktopWindow: desktop !== null, look }
}
