(() => {
  'use strict';
  const steps = Array.from(document.querySelectorAll('.guide-step'));
  const links = Array.from(document.querySelectorAll('.step-list a'));
  const previous = document.getElementById('guide-previous');
  const next = document.getElementById('guide-next');
  const progress = document.getElementById('guide-progress');
  if (!steps.length || !previous || !next || !progress) return;

  function showStep(moveFocus) {
    const requested = steps.findIndex(step => '#' + step.id === location.hash);
    const index = requested < 0 ? 0 : requested;
    steps.forEach((step, position) => step.toggleAttribute('data-active', position === index));
    links.forEach((link, position) => {
      if (position === index) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
    progress.textContent = `第 ${index + 1} / ${steps.length} 步 · 看完后切回原页面操作`;
    previous.hidden = index === 0;
    next.hidden = index === steps.length - 1;
    previous.href = '#' + steps[Math.max(0, index - 1)].id;
    next.href = '#' + steps[Math.min(steps.length - 1, index + 1)].id;
    previous.textContent = '上一步：' + steps[Math.max(0, index - 1)].querySelector('h2').textContent.replace(/^\d+\. /, '');
    next.textContent = '下一步：' + steps[Math.min(steps.length - 1, index + 1)].querySelector('h2').textContent.replace(/^\d+\. /, '');
    if (moveFocus) {
      steps[index].querySelector('h2').focus({ preventScroll: true });
      document.getElementById('guide-content').scrollIntoView({ block: 'start' });
    }
  }

  showStep(false);
  document.body.classList.add('guide-ready');
  document.querySelector('.guide-pager').hidden = false;
  window.addEventListener('hashchange', () => {
    if (location.hash === '#guide-content') {
      document.getElementById('guide-content').focus();
      return;
    }
    showStep(true);
  });
})();
