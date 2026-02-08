export function createJsonLdScript(nodes) {
  const payload = JSON.stringify(nodes, null, 2);
  return `<script type="application/ld+json">${payload}</script>`;
}
