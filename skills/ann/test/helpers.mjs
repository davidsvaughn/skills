// Shared test helpers.
export const unesc = (s) => s.replace(/&(amp|lt|gt|quot);/g, (_, e) => ({amp: '&', lt: '<', gt: '>', quot: '"'})[e])

// Every <span data-s="X">text</span> (no data-e) must equal source.slice(X, X + text.length).
export function spanMismatches(html, source) {
  const bad = []
  let n = 0
  for (const m of html.matchAll(/<span data-s="(\d+)"( data-e="\d+")?>([^<]*)<\/span>/g)) {
    n++
    if (m[2]) continue
    const s = +m[1]
    const text = unesc(m[3])
    if (source.slice(s, s + text.length) !== text) bad.push({s, text, src: source.slice(s, s + text.length)})
  }
  return {n, bad}
}
