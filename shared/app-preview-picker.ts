export const previewPickerProtocol = 'studio-preview-picker/1'
export const previewPickerScriptParam = '__studio_preview_picker'
export const previewElementTag = /^[a-z][a-z\d-]{0,63}$/i
export const previewElementPath = /^(?:body|html)(?: > [a-z][a-z\d-]{0,63}:nth-of-type\([1-9]\d*\))+$/i
export const previewPickerPathLimit = 2048
export const previewAnnotationLimit = 10
export const previewMarkerId = /^[a-z\d-]{1,64}:[1-9]\d{0,15}$/i

export interface PreviewAnnotationMarker {
  number: number
  id: string
}

export interface PreviewElement {
  tag: string
  path: string
  markerId: string
}

export interface PreviewElementRect {
  x: number
  y: number
  width: number
  height: number
}
