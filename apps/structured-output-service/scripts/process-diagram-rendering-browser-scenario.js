module.exports = async page => {
  // Run after importing a representative document with outer routes and pending form fields.
  // This scenario only navigates and reads the current page; it does not change business facts.
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const before = await page.evaluate(() => JSON.stringify(currentDocument()));
  assert(before && before !== 'null', 'Import a representative process JSON before running this scenario');
  await page.getByText('流程图', { exact: true }).first().click();
  await page.getByRole('button', { name: '流程图', exact: true }).click();
  await page.locator('[data-action="fit-flow-diagram"]').click();
  const geometry = await page.evaluate(() => {
    const cy = document.getElementById('processDiagramCanvas')._cyreg.cy;
    const nodes = cy.nodes('.behavior-node').map(node => ({ id: node.id(), bounds: node.boundingBox() }));
    const edges = cy.edges('.planned-route').map(edge => ({
      ref: edge.data('focusRef'), source: edge.data('source'), target: edge.data('target'),
      points: [edge.sourceEndpoint(), ...edge.segmentPoints(), edge.targetEndpoint()],
      midpoint: edge.midpoint(), labelBounds: edge.data('labelBounds')
    }));
    const bounds = cy.elements().renderedBoundingBox();
    const endpointsValid = cy.edges().every(edge =>
      [edge.sourceEndpoint(), edge.targetEndpoint(), edge.midpoint()].every(point =>
        point && Number.isFinite(point.x) && Number.isFinite(point.y)));
    return { nodes, edges, bounds, width: cy.width(), height: cy.height(), endpointsValid };
  });
  assert(geometry.edges.length > 0, 'The representative document must include an outer route');
  assert(geometry.endpointsValid, 'All rendered relationships must have finite endpoints and label centers');
  const crossings = [];
  for (const edge of geometry.edges) {
    const label = edge.labelBounds;
    if (label) {
      assert(Math.abs(edge.midpoint.x - (label.x1 + label.x2) / 2) < 0.1
        && Math.abs(edge.midpoint.y - (label.y1 + label.y2) / 2) < 0.1,
      `Rendered label must follow its planned track: ${edge.ref}`);
    }
    for (let index = 1; index < edge.points.length; index += 1) {
      const from = edge.points[index - 1];
      const to = edge.points[index];
      assert([from.x, from.y, to.x, to.y].every(Number.isFinite), `Invalid endpoint: ${edge.ref}`);
      const horizontal = Math.abs(from.y - to.y) < 0.1;
      const vertical = Math.abs(from.x - to.x) < 0.1;
      assert(horizontal || vertical, `Outer route must remain orthogonal: ${edge.ref}`);
      for (const node of geometry.nodes) {
        if (node.id === edge.source || node.id === edge.target) continue;
        const b = node.bounds;
        // Exclude the border stroke when testing a crossing of a node's interior.
        const crosses = horizontal
          ? from.y > b.y1 + 2 && from.y < b.y2 - 2
            && Math.max(from.x, to.x) > b.x1 + 2 && Math.min(from.x, to.x) < b.x2 - 2
          : from.x > b.x1 + 2 && from.x < b.x2 - 2
            && Math.max(from.y, to.y) > b.y1 + 2 && Math.min(from.y, to.y) < b.y2 - 2;
        if (crosses) crossings.push({ relation: edge.ref, node: node.id });
      }
    }
  }
  assert(!crossings.length, `Rendered routes cross unrelated nodes: ${JSON.stringify(crossings)}`);
  const labels = geometry.edges.filter(edge => edge.labelBounds).map(edge => ({
    ref: edge.ref, x1: edge.midpoint.x - (edge.labelBounds.x2 - edge.labelBounds.x1) / 2,
    x2: edge.midpoint.x + (edge.labelBounds.x2 - edge.labelBounds.x1) / 2,
    y1: edge.midpoint.y - (edge.labelBounds.y2 - edge.labelBounds.y1) / 2,
    y2: edge.midpoint.y + (edge.labelBounds.y2 - edge.labelBounds.y1) / 2
  }));
  labels.forEach((left, index) => labels.slice(index + 1).forEach(right => {
    assert(!(left.x1 < right.x2 && left.x2 > right.x1 && left.y1 < right.y2 && left.y2 > right.y1),
      `Rendered route labels overlap: ${left.ref}, ${right.ref}`);
  }));
  assert(geometry.bounds.x1 >= 23 && geometry.bounds.y1 >= 23
    && geometry.bounds.x2 <= geometry.width - 23 && geometry.bounds.y2 <= geometry.height - 23,
  'Full view must fit even when the required zoom is below the previous minimum');

  await page.locator('[data-action="reset-flow-diagram"]').click();
  const clear = await page.evaluate(() => {
    const cy = document.getElementById('processDiagramCanvas')._cyreg.cy;
    return {
      zoom: cy.zoom(), width: cy.width(), height: cy.height(),
      visible: cy.nodes('.behavior-node').filter(node => {
        const b = node.renderedBoundingBox();
        return b.x1 >= 0 && b.y1 >= 0 && b.x2 <= cy.width() && b.y2 <= cy.height();
      }).map(node => node.data('focusRef'))
    };
  });
  assert(clear.visible.length > 0 && clear.zoom <= 1, 'Clear view must show a complete node');

  await page.getByRole('button', { name: '环节清单', exact: true }).click();
  const selectionButton = page.locator('[data-action="select-skeleton-item"][data-kind="behavior"]').nth(1);
  const selection = { ref: await selectionButton.getAttribute('data-ref') };
  await selectionButton.click();
  await page.getByRole('button', { name: '流程图', exact: true }).click();
  await page.locator('[data-action="reset-flow-diagram"]').click();
  const selectedVisible = await page.evaluate(ref => {
    const cy = document.getElementById('processDiagramCanvas')._cyreg.cy;
    const node = cy.nodes('.behavior-node').filter(node => node.data('focusRef') === ref)[0];
    const b = node.renderedBoundingBox();
    return node.selected() && b.x1 >= 0 && b.y1 >= 0 && b.x2 <= cy.width() && b.y2 <= cy.height();
  }, selection.ref);
  assert(selectedVisible, 'Clear view must reveal the selected node instead of resetting to the origin');

  await page.getByText('检查与下载', { exact: true }).click();
  const focusResults = [];
  for (const field of ['value_usage_mode', 'value_origin_mode', 'data_field_ref']) {
    const warning = page.locator(`[data-action="focus-export-warning"][data-focus-path$=".${field}"]`).first();
    if (!await warning.count()) continue;
    const focusPath = await warning.getAttribute('data-focus-path');
    await warning.click();
    await page.locator(`[data-bind="${focusPath}"]`).waitFor({ state: 'visible' });
    await page.waitForFunction(path => document.activeElement?.dataset.bind === path, focusPath);
    await page.waitForFunction(path => {
      const control = document.querySelector(`[data-bind="${path}"]`);
      const bounds = control?.getBoundingClientRect();
      return bounds && bounds.top >= 0 && bounds.bottom <= innerHeight
        && bounds.left >= 0 && bounds.right <= innerWidth;
    }, focusPath);
    focusResults.push(focusPath);
    await page.getByText('检查与下载', { exact: true }).click();
  }
  assert(focusResults.length > 0, 'The representative document must include a pending form-field warning');
  const after = await page.evaluate(() => JSON.stringify(currentDocument()));
  assert(before === after, 'View switches and warning focus must preserve the document');
  const result = { routes: geometry.edges.length, crossings, clear, selectedVisible, focusResults, unchanged: before === after };
  console.log(`PROCESS_DIAGRAM_RENDERING_RESULT=${JSON.stringify(result)}`);
  return result;
};
