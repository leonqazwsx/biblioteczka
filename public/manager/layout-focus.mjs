const key = (node) =>
  JSON.stringify([
    node.tagName,
    node.type ?? '',
    node.getAttribute('aria-label') ?? node.textContent,
  ]);
export function rememberLayoutFocus(root) {
  const active = document.activeElement,
    wanted = active && root.contains(active) ? key(active) : null;
  return () => {
    if (wanted === null) return;
    const replacement = [...root.querySelectorAll('button,select,input')].find(
      (node) => key(node) === wanted,
    );
    const target = replacement?.disabled
      ? replacement.closest('.placement-row,.layout-pager')?.querySelector('button:not(:disabled)')
      : replacement;
    target?.focus();
  };
}
