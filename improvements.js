/* UI reliability helpers. Account/session authority remains with Supabase. */
let catalogState = 'loading';
let galleryIndex = 0;
let searchFilters = { min: '', max: '', beds: '', propertyType: '', period: '' };
let activeAccountKey = null;
let modalReturnFocus = null;

function refreshIcons() { window.lucide?.createIcons(); }
function readStorage(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('Device storage is unavailable. Your changes may not survive a reload.'); return false; }
}
function removeStorage(key) { try { localStorage.removeItem(key); } catch {} }
function accountStorageKey() { return 'nf_state_v2_' + (currentUser?.id || 'guest'); }
function loadAccountState() {
  const key = accountStorageKey();
  if (key === activeAccountKey) return;
  activeAccountKey = key;
  const state = readStorage(key, {});
  favorites = Array.isArray(state.favorites) ? state.favorites : [];
  conversations = Array.isArray(state.conversations) ? state.conversations : [];
  chatMessages = state.chatMessages && typeof state.chatMessages === 'object' && !Array.isArray(state.chatMessages) ? state.chatMessages : {};
  viewings = Array.isArray(state.viewings) ? state.viewings : [];
  currentChatId = null;
  currentChatPropertyId = null;
  photoUrls = [];
  resetListingForm();
}
function idArgument(id) { return escapeHtml(JSON.stringify(String(id))); }
function isHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
function safeImage(value) {
  return isHttpsUrl(value) ? value : 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80';
}
function localDate(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}
function filterProperties(properties, filters) {
  return properties.filter(p =>
    (filters.min === '' || p.price >= Number(filters.min)) &&
    (filters.max === '' || p.price <= Number(filters.max)) &&
    (filters.beds === '' || p.beds >= Number(filters.beds)) &&
    (!filters.propertyType || p.propType === filters.propertyType) &&
    (!filters.period || p.period === filters.period)
  );
}
function openDialog(id) {
  modalReturnFocus = document.activeElement;
  document.getElementById(id).classList.add('active');
  document.getElementById(id).querySelector('input, select, button')?.focus();
}
function openFilters() {
  for (const field of Object.keys(searchFilters)) document.getElementById('filter-' + field).value = searchFilters[field];
  document.getElementById('filter-error').textContent = '';
  openDialog('filters-modal');
}
function applyFilters(event) {
  event.preventDefault();
  const next = Object.fromEntries(Object.keys(searchFilters).map(key => [key, document.getElementById('filter-' + key).value]));
  if ((next.min !== '' && (!Number.isFinite(Number(next.min)) || Number(next.min) < 0)) ||
      (next.max !== '' && (!Number.isFinite(Number(next.max)) || Number(next.max) < 0)) ||
      (next.min !== '' && next.max !== '' && Number(next.min) > Number(next.max))) {
    document.getElementById('filter-error').textContent = 'Enter a valid price range. Maximum must be at least minimum.';
    return;
  }
  searchFilters = next;
  closeModal('filters-modal');
  runSearch();
  const count = Object.values(searchFilters).filter(v => v !== '').length;
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.toggle('active', count > 0));
}
function resetFilters() {
  searchFilters = { min: '', max: '', beds: '', propertyType: '', period: '' };
  openFilters();
  runSearch();
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
}
function changePhoto(step) {
  const property = getProperty(currentPropertyId);
  if (!property) return;
  const images = property.images?.length ? property.images : [property.image];
  galleryIndex = (galleryIndex + step + images.length) % images.length;
  document.getElementById('detail-img').src = safeImage(images[galleryIndex]);
  document.getElementById('detail-counter').textContent = `${galleryIndex + 1} / ${images.length}`;
}
function showServiceStatus(title, description) {
  document.getElementById('service-title').textContent = title;
  document.getElementById('service-description').textContent = description;
  openDialog('service-modal');
}
function openLocationSearch() {
  showScreen('search');
  document.getElementById('search-input').focus();
}
function enhanceAccessibility() {
  document.querySelectorAll('[onclick]:not(button):not(a):not(input)').forEach(el => {
    el.setAttribute('role', 'button'); el.tabIndex = 0;
  });
  document.querySelectorAll('button').forEach(el => {
    if (el.getAttribute('aria-label') || el.textContent.trim()) return;
    const icon = el.querySelector('[data-lucide]')?.getAttribute('data-lucide') || '';
    const labels = { 'heart': 'Save property', 'arrow-left': 'Go back', 'plus': 'Add a listing', 'sliders-horizontal': 'Search filters', 'send': 'Save message draft', 'calendar': 'Plan a viewing', 'settings': 'Sign in or switch account', 'bell': 'Notifications', 'x': 'Close' };
    el.setAttribute('aria-label', labels[icon] || 'Open');
  });
  document.querySelectorAll('.form-group').forEach(group => {
    const label = group.querySelector('label'); const input = group.querySelector('input,select,textarea');
    if (label && input?.id) label.htmlFor = input.id;
  });
  document.querySelectorAll('.search-bar input').forEach(el => el.setAttribute('aria-label', 'Search by area or property'));
}

const filterMarkup = `
<div class="modal-overlay" id="filters-modal" role="dialog" aria-modal="true" aria-labelledby="filters-title">
 <form class="modal-sheet filter-form" onsubmit="applyFilters(event)">
  <div class="dialog-heading"><h2 id="filters-title">Find your fit</h2><button type="button" class="icon-btn" aria-label="Close filters" onclick="closeModal('filters-modal')">×</button></div>
  <p class="filter-description">Choose a budget and the space you need.</p>
  <div class="form-row"><div class="form-group"><label for="filter-min">Min price (₦)</label><input id="filter-min" type="number" min="0" step="any" placeholder="No minimum"></div><div class="form-group"><label for="filter-max">Max price (₦)</label><input id="filter-max" type="number" min="0" step="any" placeholder="No maximum"></div></div>
  <div class="form-group"><label for="filter-period">Price period</label><select id="filter-period"><option value="">Any period</option><option value="year">Per year</option><option value="month">Per month</option><option value="night">Per night</option><option value="day">Per day</option><option value="sale">Purchase price</option></select></div>
  <div class="form-row"><div class="form-group"><label for="filter-beds">Bedrooms</label><select id="filter-beds"><option value="">Any</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option><option value="5">5+</option></select></div>
  <div class="form-group"><label for="filter-propertyType">Property type</label><select id="filter-propertyType"><option value="">Any type</option>${['Apartment','Duplex','Self Contain','Bungalow','Penthouse','Shop','Office','Hotel Room','Studio'].map(v=>`<option>${v}</option>`).join('')}</select></div></div>
  <p id="filter-error" role="alert"></p>
  <div class="dialog-actions"><button type="button" class="btn-outline" onclick="resetFilters()">Reset</button><button type="submit" class="btn-primary">Show properties</button></div>
 </form>
</div>
<div class="modal-overlay" id="service-modal" role="dialog" aria-modal="true" aria-labelledby="service-title"><div class="modal-sheet"><h2 id="service-title"></h2><p id="service-description" class="filter-description"></p><button class="btn-primary" onclick="closeModal('service-modal')">Got it</button></div></div>`;
document.getElementById('app').insertAdjacentHTML('beforeend', filterMarkup);
document.getElementById('detail-gallery').insertAdjacentHTML('beforeend', '<div class="gallery-navigation"><button class="gallery-btn" aria-label="Previous photo" onclick="changePhoto(-1)">‹</button><button class="gallery-btn" aria-label="Next photo" onclick="changePhoto(1)">›</button></div>');
document.getElementById('auth-email').autocomplete = 'email';
document.getElementById('auth-password').autocomplete = 'current-password';
document.getElementById('auth-name').autocomplete = 'name';
document.querySelectorAll('.modal-overlay').forEach(modal => {
  modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); });
});
document.addEventListener('keydown', event => {
  const modal = document.querySelector('.modal-overlay.active');
  if (event.key === 'Escape' && modal) { closeModal(modal.id); return; }
  if (event.key === 'Tab' && modal) {
    const focusable = [...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el => !el.disabled && el.offsetParent !== null);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][onclick]')) { event.preventDefault(); event.target.click(); }
});
document.addEventListener('click', () => enhanceAccessibility());
loadAccountState();
enhanceAccessibility();
if (readStorage('nf_welcomed', false)) showScreen('home');
initNestFind().catch(error => {
  console.warn('NestFind initialization failed:', error);
  currentUser = null;
  loadAccountState();
  updateProfileUI();
  loadSupabaseProperties();
});
