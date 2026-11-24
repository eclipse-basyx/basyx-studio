export const previewPickerProtocol = 'studio-preview-picker/1'
export const previewPickerScriptParam = '__studio_preview_picker'
export const previewElementTag = /^[a-z][a-z\d-]{0,63}$/i
export const previewElementPath = /^(?:body|html)(?: > [a-z][a-z\d-]{0,63}:nth-of-type\([1-9]\d*\))+$/i
export const previewPickerPathLimit = 2048

export interface PreviewElement {
  tag: string
  path: string
}

export interface PreviewElementRect {
  x: number
  y: number
  width: number
  height: number
}
