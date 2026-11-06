// Native browser content can be nested inside its fixed clipping viewport.
function views(root) {
  return root.children.flatMap(child => child.webContents ? [child] : views(child))
}
function parent(root, view) {
  if (root.children.includes(view)) return root
  for (const child of root.children) { const found = parent(child, view); if (found) return found }
}
function bounds(window, view) {
  const rect = { ...view.getBounds() }
  let ancestor = parent(window.contentView, view)
  while (ancestor && ancestor !== window.contentView) {
    const origin = ancestor.getBounds(); rect.x += origin.x; rect.y += origin.y
    ancestor = parent(window.contentView, ancestor)
  }
  return rect
}
module.exports = { views: window => window.contentView.children.filter(child => !child.webContents).flatMap(views), bounds, parent: (window, view) => parent(window.contentView, view) }
