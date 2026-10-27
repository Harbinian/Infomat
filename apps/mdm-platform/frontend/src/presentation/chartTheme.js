// Consumed by 3000 only. Node/edge identities, geometry and shared renderers stay intact.
export const chartTheme = {
  animation: false,
  backgroundColor: 'transparent', color: ['#a44e3c', '#667961', '#946528', '#8b6b52', '#a43e30'],
  textStyle: { color: '#40362f', fontFamily: 'Microsoft YaHei, sans-serif' },
  legend: { textStyle: { color: '#76695c' } },
  categoryAxis: { axisLine: { lineStyle: { color: '#b9a68e' } }, axisLabel: { color: '#76695c' } },
  valueAxis: { axisLabel: { color: '#76695c' }, splitLine: { lineStyle: { color: '#d7c8b4' } } },
  graph: { label: { color: '#40362f' } },
  tooltip: { backgroundColor: '#fcf6e9', borderColor: '#b9a68e', textStyle: { color: '#40362f' } }
};
const printStyles = new WeakMap();
export function applyDiagramTheme(cy) {
  printStyles.set(cy, cy.style().json());
  cy.style().append([
    { selector: 'node', style: { 'background-color': '#fcf6e9', 'border-color': '#a44e3c', color: '#40362f', 'text-background-color': '#fcf6e9' } },
    { selector: 'edge', style: { 'line-color': '#76695c', 'target-arrow-color': '#76695c', 'source-arrow-color': '#76695c', color: '#40362f', 'text-background-color': '#fcf6e9' } },
    { selector: ':selected', style: { 'border-color': '#a44e3c', 'line-color': '#a44e3c', 'target-arrow-color': '#a44e3c' } }
  ]).update();
}
export function printDiagram(cy, operation) {
  const original = cy.style().json();
  try {
    cy.style(printStyles.get(cy) || original).update();
    return operation();
  } finally { cy.style(original).update(); }
}
