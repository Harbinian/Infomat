(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WebGridEditors = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isCompositionKey(event, compositionActive) {
    return Boolean(compositionActive || event?.isComposing || event?.keyCode === 229);
  }

  function continueFromCell(cell) {
    if (cell?.navigateDown?.()) return 'down';
    if (cell?.navigateNext?.()) return 'next';
    if (cell?.edit?.()) return 'current';
    return 'none';
  }

  function scheduleContinuation(cell) {
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : callback => setTimeout(callback, 0);
    schedule(() => continueFromCell(cell));
  }

  function createImeSafeInputEditor(cell, onRendered, success, cancel, editorParams = {}) {
    const input = document.createElement('input');
    const originalValue = cell.getValue();
    let compositionActive = false;
    let finished = false;

    input.type = editorParams.search ? 'search' : 'text';
    input.value = originalValue == null ? '' : String(originalValue);
    input.style.padding = '4px';
    input.style.width = '100%';
    input.style.height = '100%';
    input.style.boxSizing = 'border-box';

    if (editorParams.elementAttributes && typeof editorParams.elementAttributes === 'object') {
      Object.entries(editorParams.elementAttributes).forEach(([name, value]) => {
        input.setAttribute(name, value);
      });
    }

    const finish = (moveNext = false) => {
      if (finished) return;
      finished = true;
      const nextValue = input.value;
      if (nextValue === (originalValue == null ? '' : String(originalValue))) cancel();
      else success(nextValue);
      if (moveNext) scheduleContinuation(cell);
    };

    onRendered(() => {
      input.focus({ preventScroll: true });
      if (editorParams.selectContents) input.select();
    });

    input.addEventListener('compositionstart', () => {
      compositionActive = true;
    });
    input.addEventListener('compositionend', () => {
      compositionActive = false;
    });
    input.addEventListener('blur', () => finish(false));
    input.addEventListener('change', () => finish(false));
    input.addEventListener('keydown', event => {
      if (isCompositionKey(event, compositionActive)) {
        event.stopPropagation();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finished = true;
        cancel();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') event.stopPropagation();
    });

    return input;
  }

  return {
    isCompositionKey,
    continueFromCell,
    createImeSafeInputEditor
  };
});
