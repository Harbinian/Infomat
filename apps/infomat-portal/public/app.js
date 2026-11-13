const $ = selector => document.querySelector(selector);
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  flow: '<rect x="8" y="2" width="8" height="5" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M12 7v5M5.5 17v-5h13v5"/>',
  review: '<path d="M20 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M7 7h9M7 11h6m2 7 3 3 5-7"/>',
  gantt: '<path d="M4 3v18h17M9 5h10M9 10h6m-4 5h10"/>',
  network: '<rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><path d="m6 6 3 3m6 0 3-3M6 18l3-3m6 0 3 3"/>',
  matrix: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18m6-12v12M3 15h18"/>',
  orders: '<path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M8 9h5m-5 5h3m-3 4h6m2-15h6m-3-3v6"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v9M7.5 5.5l9 5"/>',
  building: '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 7v1m6-1v1m-6 4v1m6-1v1m-6 8v-4h6v4"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m11 0a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const categories = [
  { id: 'governance', name: '流程与治理', icon: 'flow', caption: '流程编制、治理与跨部门评审。' },
  { id: 'data', name: '数据与血缘', icon: 'network', caption: '查阅系统关系，核对字段和血缘。' },
  { id: 'query', name: '查询与核对', icon: 'orders', caption: '查看订单链路、单据归属与核对结果。' },
  { id: 'collaboration', name: '项目与参考', icon: 'gantt', caption: '跟进项目安排，查阅职能与流程参考。' },
  { id: 'engineering', name: '开发与维护', icon: 'code', caption: '定位程序结构、依赖与源码快照。' }
];
let services = [];
let activeView = 'all';
let statusById = new Map();
let preferencesAvailable = true;
let favoriteIds = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('infomat-portal.favorites.v1') || '[]');
  if (Array.isArray(saved)) favoriteIds = new Set(saved.filter(id => typeof id === 'string'));
} catch { preferencesAvailable = false; }

const isLocalVisitor = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
function applicationUrl(service) {
  const host = service.access === 'loopback' ? '127.0.0.1' :
    service.access === 'fixed' && !isLocalVisitor ? service.host : location.hostname;
  return `http://${host}:${service.port}${service.path}`;
}
function notify(message) {
  $('#notice').hidden = !message;
  $('#notice').textContent = message;
}
function buttonForView(id, name, icon, count) {
  const button = document.createElement('button');
  button.className = 'nav-button';
  button.dataset.view = id;
  if (activeView === id) button.setAttribute('aria-current', 'page');
  button.innerHTML = `${svg(icon)}<span>${name}</span><span class="nav-count">${count}</span>`;
  button.addEventListener('click', () => { activeView = id; render(); });
  return button;
}
function renderNavigation() {
  $('#workspace-nav').replaceChildren(
    buttonForView('all', '全部应用', 'grid', services.length),
    buttonForView('favorites', '我的收藏', 'star', services.filter(s => favoriteIds.has(s.id)).length)
  );
  $('#category-nav').replaceChildren(...categories.map(c =>
    buttonForView(c.id, c.name, c.icon, services.filter(s => s.category === c.id).length)));
}
function statusText(state) {
  return { reachable: '网页可访问', unreachable: '暂未取得响应', unexpected: '入口待核对' }[state] || '尚未检查';
}
function cardFor(service) {
  const card = document.createElement('article');
  card.className = 'app-card';
  card.dataset.service = service.id;
  // All application text comes from the repository-owned catalog; textContent preserves it verbatim.
  card.innerHTML = `<div class="card-top"><span class="app-icon ${service.color}">${svg(service.icon)}</span><div class="card-heading"><h3></h3><p></p></div><button class="favorite-button" type="button">${svg('star')}</button></div><p class="card-description"></p><p class="card-note"></p><div class="card-footer"><span class="card-status"></span><a class="app-link" target="_blank" rel="noopener noreferrer"><span>进入应用</span>${svg('arrow')}</a></div>`;
  card.querySelector('h3').textContent = service.name;
  card.querySelector('.card-heading p').textContent = service.label;
  card.querySelector('.card-description').textContent = service.description;
  const favoriteButton = card.querySelector('.favorite-button');
  const selected = favoriteIds.has(service.id);
  favoriteButton.setAttribute('aria-label', `${selected ? '取消收藏' : '收藏'}${service.name}`);
  favoriteButton.setAttribute('aria-pressed', String(selected));
  favoriteButton.addEventListener('click', () => {
    if (favoriteIds.has(service.id)) favoriteIds.delete(service.id); else favoriteIds.add(service.id);
    try {
      localStorage.setItem('infomat-portal.favorites.v1', JSON.stringify([...favoriteIds]));
    } catch {
      preferencesAvailable = false;
      notify('浏览器未允许保存收藏。本次选择仅在当前页面有效，刷新后可能丢失。');
    }
    render();
    const nextButton = document.querySelector(`[data-service="${service.id}"] .favorite-button`);
    (nextButton || document.querySelector('[data-view="favorites"]')).focus({ preventScroll: true });
  });
  const note = card.querySelector('.card-note');
  note.textContent = service.access === 'loopback' ? '仅服务器本机可打开' : service.note || '';
  if (service.access === 'loopback') note.classList.add('local');
  const state = statusById.get(service.id)?.state;
  const status = card.querySelector('.card-status');
  status.textContent = statusText(state);
  if (state) status.classList.add(state);
  status.title = `端口 ${service.port} · 门户服务器检查结果`;
  const link = card.querySelector('.app-link');
  if (service.access === 'loopback' && !isLocalVisitor) {
    link.removeAttribute('target');
    link.setAttribute('aria-disabled', 'true');
    link.querySelector('span').textContent = '仅服务器本机';
    link.title = '请在运行 Infomat 的服务器上通过本机门户打开此应用';
  } else {
    link.href = applicationUrl(service);
    link.title = `${service.name} · ${link.href} · 在新标签页打开`;
  }
  return card;
}
function renderCards() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const visible = services.filter(service => {
    const matchesView = activeView === 'all' || (activeView === 'favorites' ? favoriteIds.has(service.id) : service.category === activeView);
    const terms = [service.name, service.label, service.description, service.port, ...service.tags].join(' ').toLocaleLowerCase();
    return matchesView && (!query || terms.includes(query));
  });
  $('#applications').replaceChildren(...visible.map(cardFor));
  $('#result-count').textContent = visible.length;
  $('#empty-state').hidden = visible.length > 0;
  if (!visible.length) {
    const isEmptyFavorites = activeView === 'favorites' && !query;
    $('#empty-title').textContent = isEmptyFavorites ? '把常用应用放在这里' : '没有找到匹配的应用';
    $('#empty-copy').textContent = isEmptyFavorites ? '点击应用右上角的星标，下次从“我的收藏”快速进入。' : '试试应用名称、用途关键词或端口，也可以切换分类。';
  }
}
function render() {
  const category = categories.find(c => c.id === activeView);
  $('#directory-title').firstChild.textContent = `${category?.name || (activeView === 'favorites' ? '我的收藏' : '全部应用')} `;
  $('#directory-caption').textContent = category?.caption || (activeView === 'favorites' ? '常用入口，随手可达。收藏保存在当前浏览器。' : '找到需要的应用，继续手头的工作。');
  renderNavigation();
  renderCards();
}
async function refreshStatus() {
  const button = $('#refresh-status');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  $('#check-time').textContent = '正在检查网页…';
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('status');
    const result = await response.json();
    statusById = new Map(result.services.map(item => [item.id, item]));
    $('#reachable-count').textContent = result.services.filter(item => item.state === 'reachable').length;
    $('#check-time').textContent = `${new Date(result.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' })} 检查`;
  } catch {
    statusById = new Map();
    $('#reachable-count').textContent = '—';
    $('#check-time').textContent = '检查失败，请重试';
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    // Replace only status text so an asynchronous check cannot steal focus from a card action.
    for (const card of document.querySelectorAll('.app-card')) {
      const state = statusById.get(card.dataset.service)?.state;
      const status = card.querySelector('.card-status');
      status.textContent = statusText(state);
      status.className = `card-status ${state || ''}`;
    }
  }
}
$('#today').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Shanghai' });
$('#apps-icon').innerHTML = svg('grid');
$('#local-icon').innerHTML = svg('network');
$('#search-icon').innerHTML = svg('search');
$('#refresh-icon').innerHTML = svg('refresh');
$('#empty-icon').innerHTML = svg('search');
$('#search').addEventListener('input', renderCards);
$('#refresh-status').addEventListener('click', refreshStatus);
$('#reset-filter').addEventListener('click', () => { activeView = 'all'; $('#search').value = ''; render(); $('#search').focus(); });
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#confirm-help').addEventListener('click', () => $('#help-dialog').close());
document.addEventListener('keydown', event => {
  if (event.key === '/' && !$('#help-dialog').open && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault(); $('#search').focus();
  }
});
try {
  const response = await fetch('/api/services');
  if (!response.ok) throw new Error('catalog');
  services = (await response.json()).services;
  favoriteIds = new Set([...favoriteIds].filter(id => services.some(service => service.id === id)));
  $('#total-count').textContent = services.length;
  $('#local-count').textContent = services.filter(service => service.access !== 'loopback').length;
  render();
  if (!preferencesAvailable) notify('浏览器未允许读取收藏，当前页面仍可正常使用。');
  await refreshStatus();
} catch {
  $('#applications').replaceChildren();
  notify('应用目录暂时无法加载，请刷新页面重试。');
}
