import { makeSpine } from './spines.mjs';
import { effectiveSpineFrame } from './spine-frame.mjs';
const motifs = [
  [['path', { d: 'M4 20H36M8 16H32M8 24H32M16 20l4-4 4 4-4 4Z' }]],
  [
    [
      'path',
      { d: 'M20 32V9M20 17C7 18 8 7 8 7c9 0 12 10 12 10Zm0 8c13 0 12-10 12-10-9 0-12 10-12 10Z' },
    ],
  ],
  [
    ['circle', { cx: 20, cy: 20, r: 11 }],
    ['path', { d: 'M7 20H33M20 7V33M12 12l16 16M12 28l16-16' }],
  ],
  [
    ['path', { d: 'M20 5l4 11 12 4-12 4-4 11-4-11-12-4 12-4Z' }],
    ['circle', { cx: 6, cy: 7, r: 1 }],
    ['circle', { cx: 34, cy: 33, r: 1 }],
  ],
  [['path', { d: 'M7 10H33V30H7ZM7 10l26 20M7 30l26-20M20 10V30' }]],
  [
    [
      'path',
      { d: 'M20 5C8 5 5 14 9 20c4 6 18 6 22 0 4-6 1-15-11-15Zm0 6v21M13 17l7 6 7-6M10 34H30' },
    ],
  ],
];
export function createSpineElement(
  book,
  { document = globalThis.document, interactive = false } = {},
) {
  const visual = makeSpine(book),
    root = document.createElement(interactive ? 'button' : 'div');
  root.className = 'spine-art';
  root.dataset.style = String(visual.spineStyle);
  root.dataset.material = visual.material;
  if (interactive) root.type = 'button';
  else root.setAttribute('role', 'img');
  root.setAttribute('aria-label', book.title + ', ' + book.authors.join(', '));
  root.title = book.title + ' · ' + book.authors.join(', ');
  for (const [key, value] of Object.entries({
    '--book-width': visual.width + 'px',
    '--spine': visual.palette[0],
    '--letter': visual.foreground,
    '--spine-accent': visual.accent,
    '--accent-ink': visual.accentForeground,
    '--title-size': visual.titleSize + 'px',
  }))
    root.style.setProperty(key, value);
  const span = (cls, text) => {
    const node = document.createElement('span');
    node.className = cls;
    if (text != null) node.textContent = text;
    node.setAttribute('aria-hidden', 'true');
    return node;
  };
  const ornament = span('spine-ornament'),
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.1');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of motifs[visual.spineStyle]) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  ornament.append(svg);
  const face = document.createElement('span');
  face.className = 'spine-visual';
  face.setAttribute('aria-hidden', 'true');
  const hasSpine = /^[a-f0-9]{64}$/.test(book.spine?.assetId ?? ''),
    hasCover = /^[a-f0-9]{64}$/.test(book.coverId ?? '');
  if (hasSpine || hasCover) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    function showArtwork(kind) {
      face.dataset.illustrated = 'true';
      face.dataset.artwork = kind;
      img.className = 'spine-image' + (kind === 'cover' ? ' spine-cover-image' : '');
      const crop = effectiveSpineFrame(kind === 'spine' ? book.spine.frame : null);
      img.style.setProperty('object-position', crop.x + '% ' + crop.y + '%');
      img.style.setProperty('transform-origin', crop.x + '% ' + crop.y + '%');
      img.style.setProperty('transform', crop.zoom === 1 ? 'none' : 'scale(' + crop.zoom + ')');
      img.src = kind === 'spine' ? '/spines/' + book.spine.assetId : '/covers/' + book.coverId;
    }
    img.onerror = () => {
      if (face.dataset.artwork === 'spine' && hasCover) showArtwork('cover');
      else {
        delete face.dataset.illustrated;
        delete face.dataset.artwork;
        img.remove?.();
      }
      root.dataset.imageError = 'true';
      root.dispatchEvent?.(new Event('spine-image-error', { bubbles: true }));
    };
    showArtwork(hasSpine ? 'spine' : 'cover');
    face.append(img);
  }
  face.append(
    span('spine-surface'),
    span('spine-inlay'),
    ornament,
    span('spine-title', book.title),
  );
  root.append(face);
  return root;
}
