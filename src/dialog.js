const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function keepFocusInside(event) {
  if (event.key !== 'Tab') return
  const controls = [...event.currentTarget.querySelectorAll(FOCUSABLE)]
    .filter((element) => !element.hidden && element.getClientRects().length > 0)
  if (!controls.length) return

  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
