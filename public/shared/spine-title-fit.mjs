// Fit the thickness of one vertical line. Length is clipped by CSS with an
// ellipsis, so a long subtitle never makes the whole title microscopic.
export function fitSpineTitle(element) {
  if (!element?.isConnected || !element.clientWidth || !element.clientHeight) return null;
  element.style.removeProperty('font-size');
  const maximum = parseFloat(getComputedStyle(element).fontSize);
  if (!Number.isFinite(maximum) || maximum <= 0) return null;
  const fits = () => element.scrollWidth <= element.clientWidth;
  const result = (fontSize) => ({
    fontSize,
    fits: fits(),
    truncated: element.scrollHeight > element.clientHeight,
  });
  if (fits()) return result(maximum);
  let low = Math.min(2, maximum),
    high = maximum;
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    element.style.fontSize = middle + 'px';
    if (fits()) low = middle;
    else high = middle;
  }
  const fontSize = Math.floor(low * 10) / 10;
  element.style.fontSize = fontSize + 'px';
  return result(fontSize);
}

const fontReadyRoots = new WeakSet();
export function fitSpineTitles(root) {
  if (!root?.isConnected) return;
  let measured = false;
  for (const title of root.querySelectorAll('.spine-title')) {
    const binding = title.closest('.spine-art');
    if (binding?.clientHeight)
      binding.style.setProperty('--binding-height', binding.clientHeight + 'px');
    if (fitSpineTitle(title)) measured = true;
  }
  const fonts = root.ownerDocument?.fonts;
  if (measured && fonts && !fontReadyRoots.has(root)) {
    fontReadyRoots.add(root);
    fonts.ready.then(() => fitSpineTitles(root));
  }
}
