(() => {
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  const $ = (id) => document.getElementById(id);
  const vesselHeading = $('vesselSection').querySelector('.heading');
  $('islandFilter').closest('label').hidden = false;
  $('manageLists').textContent = 'Manage lists';
  const islandAddButton = document.createElement('button');
  islandAddButton.type = 'button'; islandAddButton.className = 'island-filter-button island-add-button'; islandAddButton.textContent = '+ Add island';
  $('islandFilter').closest('label').after(islandAddButton);
  islandAddButton.onclick = () => { renderLists(); $('listsDialog').showModal(); requestAnimationFrame(() => $('newIsland').focus()); };
  $('addPerson').className = 'island-filter-button island-add-button';
  $('addPerson').textContent = '+ Add person';
  const addressLabel = document.createElement('label');
  addressLabel.append(document.createTextNode('Address'));
  const addressInput = document.createElement('input');
  addressInput.id = 'personAddress'; addressInput.type = 'text'; addressInput.maxLength = 250; addressInput.autocomplete = 'street-address'; addressInput.placeholder = 'Address or location';
  addressLabel.append(addressInput); $('personPhone').closest('label').after(addressLabel);
  const personIslandLabel = document.createElement('label'); personIslandLabel.append(document.createTextNode('Island'));
  const personIslandSelect = document.createElement('select'); personIslandSelect.id = 'personIsland'; personIslandSelect.required = true;
  personIslandLabel.append(personIslandSelect); $('personAddress').closest('label').after(personIslandLabel);
  const peopleIslandFilterLabel = document.createElement('label'); peopleIslandFilterLabel.append(document.createTextNode('Island'));
  const peopleIslandFilter = document.createElement('select'); peopleIslandFilter.id = 'peopleIslandFilter';
  peopleIslandFilterLabel.append(peopleIslandFilter); $('peopleSection').querySelector('.toolbar').prepend(peopleIslandFilterLabel);
  const accessKey = 'vessel_directory_access_token';
  const refreshKey = 'vessel_directory_refresh_token';
  const userKey = 'vessel_directory_user';
  const emailKey = 'vessel_directory_email';
  const state = { islands: [], types: [], vessels: [], people: [], homes: [], homePhotos: [], networkCharts: [], activeNetworkChartId: '', networkLayouts: new Map(), networkLinks: [], networkSchemaReady: false, photoPath: null, personPhotoPath: null, personPhotoBlob: null, homePhotoPath: null, homeOwnerPersonId: null, cropImage: null, cropZoom: 1, cropX: 0, cropY: 0, cropDrag: null, networkZoom: 1 };
  const apiBase = `${cfg.SUPABASE_URL}/rest/v1`;
  const headers = (extra = {}) => ({ apikey: cfg.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${localStorage.getItem(accessKey) || cfg.SUPABASE_PUBLISHABLE_KEY}`, ...extra });
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const message = (text, error = false) => { $('notice').textContent = text || ''; $('notice').classList.toggle('error', error); };
  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.floor(Math.random() * 16);
      return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    });
  }
  async function fetchTextWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`Supabase did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check your connection and try again.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function request(path, options = {}) {
    const { response, text } = await fetchTextWithTimeout(`${apiBase}/${path}`, { ...options, headers: headers(options.headers || {}) });
    if (!response.ok) {
      let detail = text;
      try { const body = JSON.parse(text); detail = body.message || body.error_description || body.details || body.hint || text; } catch {}
      throw new Error(detail || `Request failed (${response.status})`);
    }
    return text ? JSON.parse(text) : null;
  }
  async function authUser(token) {
    const { response, text } = await fetchTextWithTimeout(`${cfg.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: cfg.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    return text ? JSON.parse(text) : null;
  }
  async function refreshSession() {
    const refreshToken = localStorage.getItem(refreshKey);
    if (!refreshToken) return null;
    const { response, text } = await fetchTextWithTimeout(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: cfg.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || !data.access_token) return null;
    localStorage.setItem(accessKey, data.access_token);
    localStorage.setItem(refreshKey, data.refresh_token || refreshToken);
    localStorage.setItem(userKey, JSON.stringify(data.user || {}));
    return data.access_token;
  }
  function setSignedIn(yes) {
    $('loginView').hidden = yes; $('appView').hidden = !yes;
    $('accountArea').innerHTML = yes ? '<button id="signOut" class="secondary">Sign out</button>' : '';
    if (yes) $('signOut').onclick = logout;
  }
  function logout() { [accessKey, refreshKey, userKey].forEach(k => localStorage.removeItem(k)); setSignedIn(false); }
  async function start() {
    const savedEmail = localStorage.getItem(emailKey);
    if (savedEmail) $('email').value = savedEmail;
    let token = localStorage.getItem(accessKey);
    if (!token) return;
    try {
      let user = await authUser(token);
      if (!user) { token = await refreshSession(); user = token ? await authUser(token) : null; }
      if (!user) { logout(); $('loginMessage').textContent = 'Your saved session expired. Sign in again; your email is remembered.'; return; }
    } catch (error) {
      $('loginMessage').textContent = `Could not restore your session: ${error.message}`;
      return;
    }
    setSignedIn(true);
    try {
      await loadData();
    } catch (error) {
      message(error.message.includes('permission') || error.message.includes('row-level security') ? 'Your account is not authorized for this directory. Ask an administrator to add your user ID to vessel_staff.' : error.message, true);
      $('vesselGrid').innerHTML = '<div class="empty">Directory access could not be loaded. Check the database setup and your staff access.</div>';
    }
  }
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter || $('loginForm').querySelector('[type="submit"]');
    button.disabled = true; button.textContent = 'Connecting…'; $('loginMessage').textContent = 'Connecting securely to Supabase…'; $('loginMessage').className = 'message';
    try {
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase is not configured. Check config.js.');
      localStorage.setItem(emailKey, $('email').value.trim());
      const { response, text: responseText } = await fetchTextWithTimeout(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: cfg.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) }, 20000);
      let data = {};
      try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = { msg: responseText }; }
      if (!response.ok) throw new Error(data.error_description || data.msg || `Supabase sign-in returned HTTP ${response.status} with an empty response.`);
      if (!data.access_token) throw new Error(`Supabase sign-in returned HTTP ${response.status} without an access token. Check the browser Network tab for the auth request.`);
      $('loginMessage').textContent = 'Signed in. Loading the vessel register…';
      localStorage.setItem(accessKey, data.access_token); localStorage.setItem(refreshKey, data.refresh_token || ''); localStorage.setItem(userKey, JSON.stringify(data.user || {}));
      setSignedIn(true);
      try { await loadData(); } catch (error) { message(error.message.includes('permission') || error.message.includes('row-level security') ? 'Signed in, but your account is not on the vessel staff list. Ask an administrator to add your user ID to vessel_staff.' : error.message, true); }
    } catch (error) { $('loginMessage').textContent = error.message || 'Sign-in failed. Please try again.'; $('loginMessage').className = 'message error'; }
    finally { button.disabled = false; button.textContent = 'Sign in'; }
  });
  window.vesselLoginReady = true;
  async function loadData() {
    const [islands, types, vessels, people] = await Promise.all([
      request('vessel_islands?select=id,name&order=name'), request('vessel_types?select=id,name&order=name'),
      request('vessels?select=id,island_id,type_id,name,registration_no,driver_person_id,owner_person_id,driver,driver_id_number,driver_phone,owner,owner_id_number,owner_phone,engine_hp,photo_path,created_at&order=name'), request('person_profiles?select=id,full_name,id_number,phone,address,island_id,photo_path,created_at&order=full_name')
    ]);
    const [homes, homePhotos, layouts, links, charts] = await Promise.all([
      request('vessel_homes?select=id,name,island_id,address,photo_path,person_id,created_at&order=name').catch(() => null),
      request('vessel_home_photos?select=id,home_id,photo_path,created_at&order=created_at').catch(() => null),
      request('vessel_network_nodes?select=chart_id,node_type,node_id,x,y,width,height,note,icon').catch(() => null),
      request('vessel_network_links?select=id,chart_id,source_type,source_id,target_type,target_id,label,line_style,source_anchor,target_anchor,icon,note&order=created_at').catch(() => null),
      request('vessel_network_charts?select=id,island_id,name,created_at&order=name').catch(() => null)
    ]);
    state.islands = islands; state.types = types; state.vessels = vessels; state.people = people;
    state.homes = homes || []; state.homePhotos = homePhotos || []; state.networkCharts = charts || []; state.networkLayouts = new Map((layouts || []).map(row => [`${row.chart_id}:${row.node_type}:${row.node_id}`, row])); state.networkLinks = links || [];
    state.networkSchemaReady = homes !== null && homePhotos !== null && layouts !== null && links !== null && charts !== null;
    fillSelect($('islandFilter'), islands, 'All islands'); fillSelect($('vesselIsland'), islands, 'Choose an island'); fillSelect($('homeIsland'), islands, 'Choose an island'); fillSelect($('personIsland'), islands, 'Choose an island'); fillSelect($('peopleIslandFilter'), islands, 'All islands'); fillSelect($('vesselType'), types, 'Choose a vessel type'); fillSelect($('driverPerson'), people.map(p => ({ id: p.id, name: p.full_name })), 'No linked profile'); fillSelect($('ownerPerson'), people.map(p => ({ id: p.id, name: p.full_name })), 'No linked profile');
    render(); renderPeople(); renderLists(); renderNetwork();
  }
  function renderPeople() {
    const term = $('peopleSearch').value.trim().toLowerCase();
    const islandId = peopleIslandFilter.value;
    const rows = state.people.filter(p => (!islandId || p.island_id === islandId) && [p.full_name,p.id_number,p.phone,p.address].some(value => (value || '').toLowerCase().includes(term)));
    $('peopleGrid').innerHTML = rows.length ? rows.map(p => `<article class="person-card"><div class="person-avatar">${p.photo_path ? `<img data-person-photo="${escapeHtml(p.id)}" alt="">` : escapeHtml((p.full_name || '?').trim().charAt(0).toUpperCase())}</div><div class="person-info"><h3>${escapeHtml(p.full_name)}</h3><p><span>Island</span><strong>${escapeHtml(state.islands.find(island => island.id === p.island_id)?.name || 'Not assigned')}</strong></p><p><span>ID number</span><strong>${escapeHtml(p.id_number || 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â')}</strong></p><p><span>Phone</span><strong>${escapeHtml(p.phone || 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â')}</strong></p>${p.address ? `<p><span>Address</span><strong>${escapeHtml(p.address)}</strong></p>` : ''}</div><div class="person-actions"><button class="text-button" data-person-edit="${escapeHtml(p.id)}">Edit</button><button class="text-button delete" data-person-delete="${escapeHtml(p.id)}">Delete</button></div></article>`).join('') : '<div class="empty">No person profiles found. Add a profile to get started.</div>';
    rows.filter(p => p.photo_path).forEach(async p => { try { const url = await photoUrl(p.photo_path); const image = $('peopleGrid').querySelector(`[data-person-photo="${CSS.escape(p.id)}"]`); if (image) image.src = url; } catch {} });
    $('peopleGrid').querySelectorAll('[data-person-edit]').forEach(button => button.onclick = () => openPerson(state.people.find(p => p.id === button.dataset.personEdit)));
    $('peopleGrid').querySelectorAll('[data-person-delete]').forEach(button => button.onclick = () => deletePerson(button.dataset.personDelete));
    $('peopleGrid').querySelectorAll('.person-card').forEach(card => card.onclick = event => { if (event.target.closest('button')) return; const edit = card.querySelector('[data-person-edit]'); if (edit) openLinkedPerson(edit.dataset.personEdit); });
  }
  function drawPersonCrop() {
    const canvas = $('personCropCanvas'), ctx = canvas.getContext('2d'), image = state.cropImage;
    if (!image) return;
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height) * state.cropZoom;
    const w = image.width * scale, h = image.height * scale;
    const maxX = Math.max(0, (w - canvas.width) / 2), maxY = Math.max(0, (h - canvas.height) / 2);
    state.cropX = Math.max(-maxX, Math.min(maxX, state.cropX)); state.cropY = Math.max(-maxY, Math.min(maxY, state.cropY));
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#e8eee9'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, (canvas.width - w) / 2 + state.cropX, (canvas.height - h) / 2 + state.cropY, w, h);
  }
  $('personPhoto').addEventListener('change', () => {
    const file = $('personPhoto').files[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Choose an image file.'); $('personPhoto').value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { alert('Photo must be 8 MB or smaller.'); $('personPhoto').value = ''; return; }
    const image = new Image(), url = URL.createObjectURL(file);
    image.onload = () => { state.cropImage = image; state.cropZoom = 1; state.cropX = 0; state.cropY = 0; $('personCropZoom').value = '1'; drawPersonCrop(); $('personCropDialog').showModal(); URL.revokeObjectURL(url); };
    image.onerror = () => { URL.revokeObjectURL(url); alert('Could not open this image.'); };
    image.src = url;
  });
  $('personCropZoom').addEventListener('input', () => { state.cropZoom = Number($('personCropZoom').value); drawPersonCrop(); });
  $('personCropCanvas').addEventListener('pointerdown', event => { state.cropDrag = { x: event.clientX, y: event.clientY, cropX: state.cropX, cropY: state.cropY }; $('personCropCanvas').setPointerCapture(event.pointerId); });
  $('personCropCanvas').addEventListener('pointermove', event => { if (!state.cropDrag) return; const scale = $('personCropCanvas').width / $('personCropCanvas').getBoundingClientRect().width; state.cropX = state.cropDrag.cropX + (event.clientX - state.cropDrag.x) * scale; state.cropY = state.cropDrag.cropY + (event.clientY - state.cropDrag.y) * scale; drawPersonCrop(); });
  $('personCropCanvas').addEventListener('pointerup', () => { state.cropDrag = null; });
  $('applyPersonCrop').onclick = () => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    canvas.getContext('2d').drawImage($('personCropCanvas'), 0, 0, 512, 512);
    canvas.toBlob(blob => { state.personPhotoBlob = blob; state.personPhotoPath = null; $('personPhotoPath').value = ''; showPersonPhoto(URL.createObjectURL(blob)); $('adjustPersonCrop').hidden = false; $('personCropDialog').close(); }, 'image/jpeg', 0.9);
  };
  $('adjustPersonCrop').onclick = () => { if (state.cropImage) { drawPersonCrop(); $('personCropDialog').showModal(); } };
  document.querySelectorAll('[data-crop-close]').forEach(button => button.onclick = () => $('personCropDialog').close());
  function showPersonPhoto(path) { $('personPhotoPreview').innerHTML = ''; $('adjustPersonCrop').hidden = !state.cropImage; if (!path) return; if (path.startsWith('blob:')) { $('personPhotoPreview').innerHTML = `<img src="${escapeHtml(path)}" alt="Person profile photo">`; return; } photoUrl(path).then(url => { $('personPhotoPreview').innerHTML = `<img src="${escapeHtml(url)}" alt="Person profile photo">`; }).catch(() => { $('personPhotoPreview').textContent = 'Photo unavailable'; }); }
  async function uploadPersonPhoto(blob, personId) {
    if (!blob) return state.personPhotoPath;
    const path = `people/${personId}/${Date.now()}.jpg`;
    const response = await fetch(`${cfg.SUPABASE_URL}/storage/v1/object/vessel-photos/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }), body: blob });
    if (!response.ok) throw new Error(await response.text() || 'Profile photo upload failed.');
    return path;
  }
  function openPerson(person = null) {
    $('personForm').reset(); $('personId').value = person?.id || ''; $('personDialogTitle').textContent = person ? 'Edit person' : 'Add person'; state.personPhotoPath = person?.photo_path || null; state.personPhotoBlob = null; state.cropImage = null; $('personPhotoPath').value = state.personPhotoPath || ''; showPersonPhoto(state.personPhotoPath);
    if (person) { $('personName').value = person.full_name; $('personIdNumber').value = person.id_number || ''; $('personPhone').value = person.phone || ''; $('personAddress').value = person.address || ''; $('personIsland').value = person.island_id || ''; }
    $('personDialog').showModal();
  }
  $('addPerson').onclick = () => openPerson(); $('peopleSearch').oninput = renderPeople; peopleIslandFilter.addEventListener('change', renderPeople);
  $('personForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter || $('personForm').querySelector('[type="submit"]'); button.disabled = true;
    const existingId = $('personId').value; const id = existingId || createId();
    try {
      const row = { full_name: $('personName').value.trim(), id_number: $('personIdNumber').value.trim() || null, phone: $('personPhone').value.trim() || null, address: $('personAddress').value.trim() || null, island_id: $('personIsland').value || null, photo_path: await uploadPersonPhoto(state.personPhotoBlob, id) };
      if (existingId) await request(`person_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      else await request('person_profiles', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      $('personDialog').close(); message('Person profile saved.'); loadData().catch(error => message(`Saved, but the list could not refresh: ${error.message}`, true));
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
  });
  async function deletePerson(id) { const person = state.people.find(p => p.id === id); if (!confirm(`Delete ${person?.full_name || 'this profile'}?`)) return; try { await request(`person_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); message('Person profile deleted.'); await loadData(); } catch (error) { message(error.message, true); } }
  function networkKey(type, id) { return `${type}:${id}`; }
  function networkLayoutKey(chartId, type, id) { return `${chartId}:${type}:${id}`; }
  function networkPersonFor(vessel, role, peopleById, peopleByName) {
    const id = vessel[`${role}_person_id`];
    if (id && peopleById.has(id)) return peopleById.get(id);
    const name = (vessel[role] || '').trim(); if (!name) return null;
    const normalized = name.toLocaleLowerCase().replace(/\s+/g, ' ');
    if (peopleByName.has(normalized)) return peopleByName.get(normalized);
    const person = { id: `record-${normalized}`, full_name: name, id_number: vessel[`${role}_id_number`] || '', phone: vessel[`${role}_phone`] || '', photo_path: null, recordOnly: true };
    peopleByName.set(normalized, person); peopleById.set(person.id, person); return person;
  }
  function updateNetworkZoom() {
    const svg = $('networkChart'); if (!svg) return;
    svg.style.width = `${Math.round(Number(svg.dataset.baseWidth || 1020) * state.networkZoom)}px`;
    svg.style.height = `${Math.round(Number(svg.dataset.baseHeight || 560) * state.networkZoom)}px`;
    const label = $('networkZoomLevel'); if (label) label.textContent = `${Math.round(state.networkZoom * 100)}%`;
  }
  function setNetworkZoom(value) { state.networkZoom = Math.max(0.4, Math.min(2, value)); updateNetworkZoom(); }
  function networkEntities() {
    const peopleById = new Map(state.people.map(person => [person.id, person]));
    const peopleByName = new Map(state.people.map(person => [person.full_name.trim().toLocaleLowerCase().replace(/\s+/g, ' '), person]));
    state.vessels.forEach(vessel => ['driver', 'owner'].forEach(role => networkPersonFor(vessel, role, peopleById, peopleByName)));
    return [
      ...[...peopleById.values()].map(data => ({ type: 'person', id: data.id, data })),
      ...state.homes.map(data => ({ type: 'home', id: data.id, data })),
      ...state.vessels.map(data => ({ type: 'vessel', id: data.id, data }))
    ];
  }
  function networkConnections(entities) {
    return state.networkLinks.filter(link => link.chart_id === state.activeNetworkChartId).map(link => ({ ...link, auto: false }));
  }
  function defaultNetworkPosition(type, index) {
    const columnGap = 245, startX = 170;
    return { x: startX + index * columnGap, y: type === 'person' ? 125 : type === 'home' ? 335 : 545 };
  }
  function renderNetwork() {
    const select = $('networkIsland'); if (!select) return;
    const selectedIsland = select.value;
    select.innerHTML = '<option value="">All islands</option>' + state.islands.map(island => `<option value="${escapeHtml(island.id)}">${escapeHtml(island.name)}</option>`).join('');
    if (state.islands.some(island => island.id === selectedIsland)) select.value = selectedIsland;
    const chartSelect = $('networkChartSelect'), previousChart = chartSelect.value;
    const islandCharts = state.networkCharts.filter(chart => selectedIsland ? chart.island_id === selectedIsland : !chart.island_id);
    chartSelect.innerHTML = islandCharts.map(chart => `<option value="${escapeHtml(chart.id)}">${escapeHtml(chart.name)}</option>`).join('');
    chartSelect.value = islandCharts.some(chart => chart.id === previousChart) ? previousChart : (islandCharts[0]?.id || '');
    state.activeNetworkChartId = chartSelect.value;
    chartSelect.disabled = !state.networkSchemaReady || !islandCharts.length;
    $('networkAddChart').disabled = !state.networkSchemaReady || !selectedIsland;
    const query = $('networkSearch').value.trim().toLocaleLowerCase();
    const chartMembers = networkEntities().filter(item => state.networkLayouts.has(networkLayoutKey(state.activeNetworkChartId, item.type, item.id)));
    $('networkAddNode').disabled = !state.networkSchemaReady || !state.activeNetworkChartId;
    $('networkAddLink').disabled = !state.networkSchemaReady || !state.activeNetworkChartId || chartMembers.length < 2;
    const entities = chartMembers, allLinks = networkConnections(entities);
    let allowed = new Set(entities.map(item => networkKey(item.type, item.id)));
    if (query) {
      const matched = new Set(entities.filter(item => {
        const island = state.islands.find(value => value.id === item.data.island_id)?.name || '';
        return [item.data.full_name, item.data.name, item.data.registration_no, item.data.id_number, item.data.phone, item.data.address, island].some(value => (value || '').toLocaleLowerCase().includes(query));
      }).map(item => networkKey(item.type, item.id)));
      allLinks.forEach(link => { const source = networkKey(link.source_type, link.source_id), target = networkKey(link.target_type, link.target_id); if (matched.has(source)) matched.add(target); if (matched.has(target)) matched.add(source); });
      allowed = new Set([...allowed].filter(key => matched.has(key)));
    }
    const visible = entities.filter(item => allowed.has(networkKey(item.type, item.id)));
    const visibleKeys = new Set(visible.map(item => networkKey(item.type, item.id)));
    const links = allLinks.filter(link => visibleKeys.has(networkKey(link.source_type, link.source_id)) && visibleKeys.has(networkKey(link.target_type, link.target_id)));
    const groups = { person: visible.filter(item => item.type === 'person'), home: visible.filter(item => item.type === 'home'), vessel: visible.filter(item => item.type === 'vessel') };
    const positions = new Map();
    for (const type of ['person', 'home', 'vessel']) groups[type].forEach((item, index) => {
      const key = networkKey(type, item.id), stored = state.networkLayouts.get(networkLayoutKey(state.activeNetworkChartId, type, item.id)), fallback = defaultNetworkPosition(type, index);
      positions.set(key, { x: Number(stored?.x ?? fallback.x), y: Number(stored?.y ?? fallback.y) });
    });
    state.visibleNetworkEntities = visible; state.visibleNetworkLinks = links; state.visibleNetworkPositions = positions;
    const maxX = Math.max(980, ...[...positions.values()].map(pos => pos.x + 330));
    const maxY = Math.max(650, ...[...positions.values()].map(pos => pos.y + 300));
    const svg = $('networkChart'); svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`); svg.dataset.baseWidth = maxX; svg.dataset.baseHeight = maxY; updateNetworkZoom();
    const setupNotice = $('networkSetupNotice');
    if (setupNotice) { setupNotice.hidden = state.networkSchemaReady; setupNotice.textContent = state.networkSchemaReady ? '' : 'Run supabase-vessel-island-charts.sql and supabase-vessel-person-homes.sql in Supabase before using home records.'; }
    $('networkAddHome').disabled = !state.networkSchemaReady;
    if (!state.activeNetworkChartId) { svg.innerHTML = `<text class="network-empty" x="${maxX / 2}" y="120" text-anchor="middle">${selectedIsland ? 'No chart for this island yet. Create one to get started.' : 'Choose an island to open its charts.'}</text>`; return; }
    if (!visible.length) { svg.innerHTML = `<text class="network-empty" x="${maxX / 2}" y="120" text-anchor="middle">${query ? 'No matching records on this chart.' : 'This chart is empty. Add existing people, vessels, or homes to begin.'}</text>`; return; }
    const nodeMarkup = visible.map(item => {
      const key = networkKey(item.type, item.id), pos = positions.get(key), stored = state.networkLayouts.get(networkLayoutKey(state.activeNetworkChartId, item.type, item.id)) || {}, { data, type } = item;
      const width = type === 'person' ? Number(stored.width || 160) : 238, height = type === 'person' ? Number(stored.height || 190) : 62, photo = data.photo_path || '', title = type === 'person' ? data.full_name : data.name;
      const subtitle = type === 'person' ? (data.id_number || data.phone || (data.recordOnly ? 'Vessel contact' : 'Person profile')) : type === 'home' ? (data.address || state.islands.find(island => island.id === data.island_id)?.name || 'Home') : `${data.registration_no} Â· ${state.islands.find(island => island.id === data.island_id)?.name || 'Island'}`;
      const clipId = `clip-${String(type + item.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const avatarX = -width / 2 + 27;
      const note = stored.note ? `<g class="network-sticky-note" transform="translate(${width / 2 + 4} -20)"><rect width="142" height="48" rx="5"></rect><text x="9" y="18">${escapeHtml(String(stored.note).slice(0, 24))}</text><text x="9" y="34">${escapeHtml(String(stored.note).slice(24, 48))}</text></g>` : '';
      const defaultIcon = type === 'home' ? '\u2302' : '';
      if (type === 'person') {
        const initials = escapeHtml((title || '?').trim().charAt(0).toUpperCase());
        const idLine = `ID: ${data.id_number || 'Not provided'}`, phoneLine = `Phone: ${data.phone || 'Not provided'}`;
        const photoWidth = Math.min(116, width - 32), photoHeight = Math.min(124, height - 70), photoY = -height / 2 + 10;
        const infoTop = photoY + photoHeight + 22;
        const maxChars = Math.max(12, Math.floor((width - 18) / 6));
        return `<g class="network-node person-node person-card-node" data-network-node-key="${escapeHtml(key)}" data-network-node-type="person" data-network-node-id="${escapeHtml(item.id)}" data-node-width="${width}" data-node-height="${height}" data-x="${pos.x}" data-y="${pos.y}" transform="translate(${pos.x} ${pos.y})" role="button" tabindex="0" aria-label="View person ${escapeHtml(title)}"><defs><clipPath id="${clipId}"><rect class="person-photo-clip" x="${-photoWidth / 2}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" rx="9"></rect></clipPath></defs><rect class="network-node-card" x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="14"></rect><rect class="person-photo-placeholder" x="${-photoWidth / 2}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" rx="9"></rect><text class="person-photo-initial" x="0" y="${photoY + photoHeight / 2 + 13}" text-anchor="middle">${initials}</text>${photo ? `<image class="network-node-photo" data-network-photo="${escapeHtml(key)}" x="${-photoWidth / 2}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" style="display:none"></image>` : ''}<text class="network-title person-card-title" x="0" y="${infoTop}" text-anchor="middle">${escapeHtml(String(title || '').slice(0, maxChars))}</text><text class="network-subtitle person-card-detail" x="0" y="${infoTop + 17}" text-anchor="middle">${escapeHtml(idLine.slice(0, maxChars))}</text><text class="network-subtitle person-card-detail" x="0" y="${infoTop + 32}" text-anchor="middle">${escapeHtml(phoneLine.slice(0, maxChars))}</text><rect class="network-node-resize" data-node-resize x="${width / 2 - 14}" y="${height / 2 - 14}" width="14" height="14" rx="3" aria-label="Resize person card"></rect>${note}</g>`;
      }
      return `<g class="network-node ${type}-node" data-network-node-key="${escapeHtml(key)}" data-network-node-type="${type}" data-network-node-id="${escapeHtml(item.id)}" data-node-width="${width}" data-node-height="${height}" data-x="${pos.x}" data-y="${pos.y}" transform="translate(${pos.x} ${pos.y})" role="button" tabindex="0" aria-label="View ${type} ${escapeHtml(title)}"><defs><clipPath id="${clipId}"><circle cx="${avatarX}" cy="0" r="18"></circle></clipPath></defs><rect class="network-node-card" x="${-width / 2}" y="-31" width="${width}" height="62" rx="15"></rect><circle class="network-avatar-fallback" cx="${avatarX}" cy="0" r="18"></circle><text class="network-initial" x="${avatarX}" y="5" text-anchor="middle">${escapeHtml((title || '?').trim().charAt(0).toUpperCase())}</text>${photo ? `<image class="network-node-photo" data-network-photo="${escapeHtml(key)}" x="${avatarX - 18}" y="-18" width="36" height="36" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" style="display:none"></image>` : ''}<text class="network-node-icon" x="${width / 2 - 22}" y="-14">${escapeHtml(stored.icon || defaultIcon)}</text><text class="network-title" x="${avatarX + 27}" y="-3">${escapeHtml(String(title || '').slice(0, 24))}</text><text class="network-subtitle" x="${avatarX + 27}" y="15">${escapeHtml(String(subtitle || '').slice(0, 30))}</text>${note}</g>`;
    }).join('');
    const linkMarkup = links.map(link => {
      const sourceKey = networkKey(link.source_type, link.source_id), targetKey = networkKey(link.target_type, link.target_id);
      const a = positions.get(sourceKey), b = positions.get(targetKey);
      if (!a || !b) return '';
      const sourceAnchor = link.source_anchor || 'auto', targetAnchor = link.target_anchor || 'auto', style = link.line_style || 'solid';
      const fromSide = sourceAnchor === 'auto' ? (Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x >= a.x ? 'right' : 'left') : (b.y >= a.y ? 'bottom' : 'top')) : sourceAnchor;
      const toSide = targetAnchor === 'auto' ? (Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? (a.x >= b.x ? 'right' : 'left') : (a.y >= b.y ? 'bottom' : 'top')) : targetAnchor;
      const point = (pos, side, type, id) => {
        const layout = type === 'person' ? state.networkLayouts.get(networkLayoutKey(state.activeNetworkChartId, type, id)) || {} : {};
        const halfWidth = (type === 'person' ? Number(layout.width || 160) : 238) / 2;
        if (side === 'left') return { x: pos.x - halfWidth, y: pos.y };
        if (side === 'right') return { x: pos.x + halfWidth, y: pos.y };
        const halfHeight = (type === 'person' ? Number(layout.height || 190) : 62) / 2;
        return { x: pos.x, y: pos.y + (side === 'bottom' ? halfHeight : -halfHeight) };
      };
      const start = point(a, fromSide, link.source_type, link.source_id), end = point(b, toSide, link.target_type, link.target_id);
      const horizontal = ['left', 'right'].includes(fromSide) || ['left', 'right'].includes(toSide), bend = Math.max(50, Math.min(130, Math.abs(horizontal ? end.x - start.x : end.y - start.y) * 0.45));
      const path = horizontal ? `M ${start.x} ${start.y} C ${start.x + (fromSide === 'left' ? -bend : bend)} ${start.y}, ${end.x + (toSide === 'left' ? -bend : bend)} ${end.y}, ${end.x} ${end.y}` : `M ${start.x} ${start.y} C ${start.x} ${start.y + (fromSide === 'top' ? -bend : bend)}, ${end.x} ${end.y + (toSide === 'top' ? -bend : bend)}, ${end.x} ${end.y}`;
      const midX = (start.x + end.x) / 2, midY = (start.y + end.y) / 2;
      return `<g class="network-edge ${style}" data-network-edge data-source-key="${escapeHtml(sourceKey)}" data-target-key="${escapeHtml(targetKey)}" data-source-anchor="${escapeHtml(sourceAnchor)}" data-target-anchor="${escapeHtml(targetAnchor)}" ${link.auto ? '' : `data-custom-link="${escapeHtml(link.id)}" role="button" tabindex="0" aria-label="Edit connection ${escapeHtml(link.label)}"`}><path d="${path}"></path><rect x="${midX - 42}" y="${midY - 11}" width="84" height="22" rx="11"></rect><text x="${midX}" y="${midY + 4}" text-anchor="middle">${escapeHtml(`${link.icon || ''} ${link.label || 'Connected'}`.trim().slice(0, 24))}</text>${link.note ? `<g class="network-link-note" transform="translate(${midX + 45} ${midY - 18})"><rect width="120" height="38" rx="4"></rect><text x="6" y="16">${escapeHtml(String(link.note).slice(0, 18))}</text><text x="6" y="30">${escapeHtml(String(link.note).slice(18, 36))}</text></g>` : ''}</g>`;
    }).join('');
    svg.innerHTML = linkMarkup + nodeMarkup;
    visible.filter(item => item.data.photo_path).forEach(async item => { try { const url = await photoUrl(item.data.photo_path); const image = svg.querySelector(`[data-network-photo="${CSS.escape(networkKey(item.type, item.id))}"]`); if (image) { image.setAttribute('href', url); image.style.display = 'block'; } } catch {} });
    $('networkSelection').innerHTML = '<div class="network-selection-empty">Select a person, home, or vessel. Drag nodes to arrange the chart.</div>';
  }
  function updateNetworkEdges() {
    const svg = $('networkChart');
    svg.querySelectorAll('[data-network-edge]').forEach(edge => {
      const source = svg.querySelector(`[data-network-node-key="${CSS.escape(edge.dataset.sourceKey)}"]`), target = svg.querySelector(`[data-network-node-key="${CSS.escape(edge.dataset.targetKey)}"]`);
      if (!source || !target) return;
      const x1 = Number(source.dataset.x), y1 = Number(source.dataset.y), x2 = Number(target.dataset.x), y2 = Number(target.dataset.y);
      source.dataset.targetX = x2; source.dataset.targetY = y2; target.dataset.targetX = x1; target.dataset.targetY = y1;
      const fromSide = edge.dataset.sourceAnchor === 'auto' ? (Math.abs(x2 - x1) > Math.abs(y2 - y1) ? (x2 >= x1 ? 'right' : 'left') : (y2 >= y1 ? 'bottom' : 'top')) : edge.dataset.sourceAnchor;
      const toSide = edge.dataset.targetAnchor === 'auto' ? (Math.abs(x1 - x2) > Math.abs(y1 - y2) ? (x1 >= x2 ? 'right' : 'left') : (y1 >= y2 ? 'bottom' : 'top')) : edge.dataset.targetAnchor;
      const point = (node, side) => { const width = Number(node.dataset.nodeWidth || 238), height = Number(node.dataset.nodeHeight || 62), x = Number(node.dataset.x), y = Number(node.dataset.y); return side === 'left' ? { x: x - width / 2, y } : side === 'right' ? { x: x + width / 2, y } : { x, y: y + (side === 'bottom' ? height / 2 : -height / 2) }; };
      const a = point(source, fromSide), b = point(target, toSide), horizontal = ['left', 'right'].includes(fromSide) || ['left', 'right'].includes(toSide), bend = Math.max(50, Math.min(130, Math.abs(horizontal ? b.x - a.x : b.y - a.y) * 0.45));
      const path = horizontal ? `M ${a.x} ${a.y} C ${a.x + (fromSide === 'left' ? -bend : bend)} ${a.y}, ${b.x + (toSide === 'left' ? -bend : bend)} ${b.y}, ${b.x} ${b.y}` : `M ${a.x} ${a.y} C ${a.x} ${a.y + (fromSide === 'top' ? -bend : bend)}, ${b.x} ${b.y + (toSide === 'top' ? -bend : bend)}, ${b.x} ${b.y}`;
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      edge.querySelector('path').setAttribute('d', path);
      const rect = edge.querySelector('rect'), text = edge.querySelector('text'); rect.setAttribute('x', midX - 42); rect.setAttribute('y', midY - 11); text.setAttribute('x', midX); text.setAttribute('y', midY + 4);
      const note = edge.querySelector('.network-link-note'); if (note) note.setAttribute('transform', `translate(${midX + 45} ${midY - 18})`);
    });
  }
  function networkNodeByKey(key) { return (state.visibleNetworkEntities || []).find(item => networkKey(item.type, item.id) === key); }
  async function saveNetworkPosition(node, x, y) {
    const type = node.dataset.networkNodeType, id = node.dataset.networkNodeId;
    if (!state.networkSchemaReady) { $('networkEditStatus').textContent = 'Run supabase-vessel-island-charts.sql in Supabase before saving chart edits.'; return; }
    if (!state.activeNetworkChartId) return;
    if (id.startsWith('record-')) { $('networkEditStatus').textContent = 'Add this contact as a person profile to save its chart position.'; return; }
    const key = networkLayoutKey(state.activeNetworkChartId, type, id), old = state.networkLayouts.get(key) || {};
    const row = { chart_id: state.activeNetworkChartId, node_type: type, node_id: id, x, y, ...(type === 'person' ? { width: Number(node.dataset.nodeWidth || old.width || 160), height: Number(node.dataset.nodeHeight || old.height || 190) } : {}), note: old.note || null, icon: old.icon || null };
    try {
      await request('vessel_network_nodes?on_conflict=chart_id,node_type,node_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      state.networkLayouts.set(key, row); $('networkEditStatus').textContent = 'Position saved.';
    } catch (error) { $('networkEditStatus').textContent = `Could not save position: ${error.message}`; }
  }
  let networkDrag = null, networkResize = null;
  function svgPoint(event) { const svg = $('networkChart'), point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; return point.matrixTransform(svg.getScreenCTM().inverse()); }
  function resizePersonCard(node, width, height) {
    width = Math.max(140, Math.min(320, width)); height = Math.max(160, Math.min(360, height));
    node.dataset.nodeWidth = width; node.dataset.nodeHeight = height;
    const card = node.querySelector('.network-node-card'); card.setAttribute('x', -width / 2); card.setAttribute('y', -height / 2); card.setAttribute('width', width); card.setAttribute('height', height);
    const photoWidth = Math.min(116, width - 32), photoHeight = Math.min(124, height - 70), photoY = -height / 2 + 10, photoX = -photoWidth / 2;
    const photoElements = [node.querySelector('.person-photo-clip'), node.querySelector('.person-photo-placeholder'), node.querySelector('.network-node-photo')].filter(Boolean);
    photoElements.forEach(element => { element.setAttribute('x', photoX); element.setAttribute('y', photoY); element.setAttribute('width', photoWidth); element.setAttribute('height', photoHeight); });
    node.querySelector('.person-photo-initial').setAttribute('y', photoY + photoHeight / 2 + 13);
    const infoTop = photoY + photoHeight + 22, details = node.querySelectorAll('.person-card-detail');
    node.querySelector('.person-card-title').setAttribute('y', infoTop);
    details[0].setAttribute('y', infoTop + 17); details[1].setAttribute('y', infoTop + 32);
    const handle = node.querySelector('[data-node-resize]'); handle.setAttribute('x', width / 2 - 14); handle.setAttribute('y', height / 2 - 14);
    updateNetworkEdges();
  }
  $('networkChart').addEventListener('pointerdown', event => {
    const node = event.target.closest('[data-network-node-key]'); if (!node) return;
    if (!state.networkSchemaReady) { $('networkEditStatus').textContent = 'Run supabase-vessel-island-charts.sql in Supabase before moving nodes.'; return; }
    if (event.target.closest('[data-node-resize]')) {
      const point = svgPoint(event); networkResize = { node, pointerId: event.pointerId, startX: point.x, startY: point.y, width: Number(node.dataset.nodeWidth), height: Number(node.dataset.nodeHeight), x: Number(node.dataset.x), y: Number(node.dataset.y) };
      $('networkChart').setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    networkDrag = { node, moved: false, pointerId: event.pointerId }; $('networkChart').setPointerCapture(event.pointerId); event.preventDefault();
  });
  $('networkChart').addEventListener('pointermove', event => {
    if (networkResize && networkResize.pointerId === event.pointerId) {
      const point = svgPoint(event), { node, startX, startY, width, height, x, y } = networkResize;
      const nextWidth = Math.max(140, Math.min(320, width + point.x - startX)), nextHeight = Math.max(160, Math.min(360, height + point.y - startY));
      const nextX = x + (nextWidth - width) / 2, nextY = y + (nextHeight - height) / 2;
      node.dataset.x = nextX; node.dataset.y = nextY; node.setAttribute('transform', `translate(${nextX} ${nextY})`);
      state.visibleNetworkPositions.set(node.dataset.networkNodeKey, { x: nextX, y: nextY });
      resizePersonCard(node, nextWidth, nextHeight);
      const positions = [...state.visibleNetworkPositions.values()], svg = $('networkChart'), chartWidth = Math.max(980, ...positions.map(pos => pos.x + 330)), chartHeight = Math.max(650, ...positions.map(pos => pos.y + 300));
      svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`); svg.dataset.baseWidth = chartWidth; svg.dataset.baseHeight = chartHeight; updateNetworkZoom(); event.preventDefault(); return;
    }
    if (!networkDrag || networkDrag.pointerId !== event.pointerId) return;
    const point = svgPoint(event), node = networkDrag.node, x = Math.max(120, point.x), y = Math.max(55, point.y);
    if (Math.abs(x - Number(node.dataset.x)) + Math.abs(y - Number(node.dataset.y)) > 2) networkDrag.moved = true;
    node.dataset.x = x; node.dataset.y = y; node.setAttribute('transform', `translate(${x} ${y})`);
    const key = node.dataset.networkNodeKey; state.visibleNetworkPositions.set(key, { x, y }); updateNetworkEdges();
    const positions = [...state.visibleNetworkPositions.values()], width = Math.max(980, ...positions.map(pos => pos.x + 330)), height = Math.max(650, ...positions.map(pos => pos.y + 300));
    const svg = $('networkChart'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.dataset.baseWidth = width; svg.dataset.baseHeight = height; updateNetworkZoom();
  });
  $('networkChart').addEventListener('pointerup', async event => {
    if (networkResize && networkResize.pointerId === event.pointerId) {
      const { node } = networkResize; networkResize = null;
      await saveNetworkPosition(node, Number(node.dataset.x), Number(node.dataset.y)); return;
    }
    if (!networkDrag || networkDrag.pointerId !== event.pointerId) return;
    const { node, moved } = networkDrag; networkDrag = null;
    if (moved) await saveNetworkPosition(node, Number(node.dataset.x), Number(node.dataset.y));
  });
  async function showNetworkNode(node) {
    const type = node.dataset.networkNodeType, id = node.dataset.networkNodeId, key = networkKey(type, id), entity = networkNodeByKey(key);
    if (!entity) return;
    const data = entity.data, layout = state.networkLayouts.get(networkLayoutKey(state.activeNetworkChartId, type, id)) || {}, selection = $('networkSelection');
    const title = type === 'person' ? data.full_name : data.name;
    let subtitle = type === 'person' ? [data.id_number, data.phone].filter(Boolean).join(' Â· ') || 'Person profile' : type === 'home' ? [state.islands.find(item => item.id === data.island_id)?.name, data.address].filter(Boolean).join(' Â· ') : [data.registration_no, state.islands.find(item => item.id === data.island_id)?.name].filter(Boolean).join(' Â· ');
    selection.innerHTML = `<div class="network-detail-heading"><div class="network-detail-avatar" id="networkDetailAvatar">${escapeHtml((title || '?').trim().charAt(0).toUpperCase())}</div><div><div class="eyebrow">${type.toUpperCase()}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></div>${type === 'vessel' ? `<div class="network-related"><strong>Engine</strong><span>${data.engine_hp == null ? 'Not provided' : `${escapeHtml(data.engine_hp)} HP`}</span></div>` : ''}${type === 'person' ? `<div class="dialog-actions"><button type="button" class="secondary" data-open-person-profile="${escapeHtml(id)}">View full profile, homes and vessels</button></div>` : ''}<div class="dialog-actions network-direct-connect"><button type="button" class="secondary" data-connect-node="${escapeHtml(key)}">Connect to another card</button></div><form id="networkAnnotationForm" class="network-annotation-form" data-node-type="${type}" data-node-id="${escapeHtml(id)}"><label>Sticky note<textarea id="networkNodeNote" maxlength="1000" placeholder="Add a note near this node">${escapeHtml(layout.note || '')}</textarea></label><label>Node icon<input id="networkNodeIcon" maxlength="8" value="${escapeHtml(layout.icon || '')}" placeholder="Optional emoji, e.g. âš“"></label><div class="dialog-actions"><button class="primary" type="submit">Save note and icon</button>${type === 'home' ? `<button type="button" class="secondary" data-edit-home="${escapeHtml(id)}">Edit home</button>` : ''}</div></form><div class="network-related"><strong>Connection(s)</strong><span>${(state.visibleNetworkLinks || []).filter(link => networkKey(link.source_type, link.source_id) === key || networkKey(link.target_type, link.target_id) === key).map(link => escapeHtml(link.label || 'Connected')).join(' Â· ') || 'No connections'}</span></div>`;
    if (data.photo_path) { try { const url = await photoUrl(data.photo_path), avatar = $('networkDetailAvatar'); if (avatar) avatar.innerHTML = `<img src="${escapeHtml(url)}" alt="">`; } catch {} }
  }
  async function saveNetworkAnnotation(form) {
    if (!state.networkSchemaReady) { $('networkEditStatus').textContent = 'Run supabase-vessel-island-charts.sql in Supabase before saving chart edits.'; return; }
    const type = form.dataset.nodeType, id = form.dataset.nodeId, key = networkKey(type, id), node = $('networkChart').querySelector(`[data-network-node-key="${CSS.escape(key)}"]`);
    if (!node || id.startsWith('record-')) { $('networkEditStatus').textContent = 'Add this person as a profile before saving chart notes.'; return; }
    const layoutKey = networkLayoutKey(state.activeNetworkChartId, type, id), old = state.networkLayouts.get(layoutKey) || { x: Number(node.dataset.x), y: Number(node.dataset.y) };
    const row = { chart_id: state.activeNetworkChartId, node_type: type, node_id: id, x: Number(node.dataset.x), y: Number(node.dataset.y), note: $('networkNodeNote').value.trim() || null, icon: $('networkNodeIcon').value.trim() || null };
    try {
      await request('vessel_network_nodes?on_conflict=chart_id,node_type,node_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      state.networkLayouts.set(layoutKey, row); $('networkEditStatus').textContent = 'Note and icon saved.'; renderNetwork();
    } catch (error) { $('networkEditStatus').textContent = `Could not save note: ${error.message}`; }
  }
  async function uploadHomePhoto(file, homeId) {
    if (!file) return state.homePhotoPath;
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the home photo.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Home photo must be 8 MB or smaller.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `homes/${homeId}/${Date.now()}.${ext}`;
    const { response, text } = await fetchTextWithTimeout(`${cfg.SUPABASE_URL}/storage/v1/object/vessel-photos/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: headers({ 'Content-Type': file.type, 'x-upsert': 'true' }), body: file }, 45000);
    if (!response.ok) throw new Error(text || 'Home photo upload failed.'); return path;
  }
  function openHome(home = null, personId = null) {
    if (!state.networkSchemaReady) { alert('Run supabase-vessel-island-charts.sql and supabase-vessel-person-homes.sql in Supabase before adding homes.'); return; }
    $('homeForm').reset(); fillSelect($('homeIsland'), state.islands, 'Choose an island');
    $('homeId').value = home?.id || ''; state.homeOwnerPersonId = personId || home?.person_id || null; $('homeDialogTitle').textContent = home ? 'Edit home' : personId ? 'Add home photo' : 'Add home'; state.homePhotoPath = home?.photo_path || null;
    if (home) { $('homeName').value = home.name; $('homeIsland').value = home.island_id || ''; $('homeAddress').value = home.address || ''; }
    $('homePhotoPreview').innerHTML = home?.photo_path ? '<span class="hint">Loading current photo…</span>' : '';
    if (home?.photo_path) photoUrl(home.photo_path).then(url => { $('homePhotoPreview').innerHTML = `<img src="${escapeHtml(url)}" alt="Home photo">`; }).catch(() => { $('homePhotoPreview').textContent = 'Current photo unavailable.'; });
    $('homePhoto').onchange = () => { const files = [...$('homePhoto').files]; $('homePhotoPreview').innerHTML = files.length ? `<span class="hint">${files.length} photo${files.length === 1 ? '' : 's'} selected: ${files.map(file => escapeHtml(file.name)).join(', ')}</span>` : ''; };
    $('homeDialog').showModal();
  }
  async function saveHome(event) {
    event.preventDefault(); const button = event.submitter || $('homeForm').querySelector('[type="submit"]'); button.disabled = true;
    const existingId = $('homeId').value, id = existingId || createId();
    try {
      const selectedPhotos = [...$('homePhoto').files];
      if (selectedPhotos.some(file => !file.type.startsWith('image/'))) throw new Error('Choose image files for home photos.');
      if (selectedPhotos.some(file => file.size > 8 * 1024 * 1024)) throw new Error('Each home photo must be 8 MB or smaller.');
      const photoPath = selectedPhotos.length ? await uploadHomePhoto(selectedPhotos[0], id) : state.homePhotoPath;
      const row = { name: $('homeName').value.trim(), island_id: $('homeIsland').value || null, address: $('homeAddress').value.trim() || null, photo_path: photoPath, person_id: state.homeOwnerPersonId };
      if (existingId) await request(`vessel_homes?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      else await request('vessel_homes', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, ...row }) });
      const extraPhotos = selectedPhotos.slice(1);
      if (extraPhotos.length) {
        const paths = await Promise.all(extraPhotos.map(file => uploadHomePhoto(file, id)));
        await request('vessel_home_photos', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(paths.map(path => ({ home_id: id, photo_path: path }))) });
      }
      const returnPersonId = state.homeOwnerPersonId; state.homeOwnerPersonId = null;
      $('homeDialog').close(); await loadData();
      if (returnPersonId) await openLinkedPerson(returnPersonId);
      $('networkEditStatus').textContent = 'Home saved.';
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
  }
  async function addPhotosToHome(homeId, files, personId) {
    const button = document.querySelector(`[data-add-home-photos="${CSS.escape(homeId)}"]`);
    if (!files.length) return;
    if (files.some(file => !file.type.startsWith('image/'))) { alert('Choose image files for home photos.'); return; }
    if (files.some(file => file.size > 8 * 1024 * 1024)) { alert('Each home photo must be 8 MB or smaller.'); return; }
    if (button) { button.disabled = true; button.textContent = 'Uploading…'; }
    try {
      const paths = await Promise.all(files.map(file => uploadHomePhoto(file, homeId)));
      await request('vessel_home_photos', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(paths.map(path => ({ home_id: homeId, photo_path: path }))) });
      $('linkedPersonDialog').close(); await loadData(); await openLinkedPerson(personId);
    } catch (error) { alert(error.message); if (button) { button.disabled = false; button.textContent = '+ Add photos'; } }
  }
  function openAddNetworkNode() {
    if (!state.networkSchemaReady || !state.activeNetworkChartId) { alert('Choose or create an island chart first.'); return; }
    const chart = state.networkCharts.find(item => item.id === state.activeNetworkChartId);
    const existing = new Set([...state.networkLayouts.keys()].filter(key => key.startsWith(`${state.activeNetworkChartId}:`)).map(key => key.slice(state.activeNetworkChartId.length + 1)));
    const options = networkEntities().filter(item => !item.data.recordOnly && !existing.has(`${item.type}:${item.id}`) &&
      (item.type === 'person' || !chart?.island_id || item.data.island_id === chart.island_id));
    $('networkNodeEntity').innerHTML = '<option value="">Choose an existing record</option>' + options.map(item => {
      const title = item.type === 'person' ? item.data.full_name : item.data.name;
      const islandName = state.islands.find(island => island.id === item.data.island_id)?.name;
      return `<option value="${escapeHtml(networkKey(item.type, item.id))}">${escapeHtml(`${item.type === 'person' ? 'Person' : item.type === 'home' ? 'Home' : 'Vessel'} · ${title}${islandName ? ` · ${islandName}` : ''}`)}</option>`;
    }).join('');
    $('networkNodeEmpty').hidden = options.length > 0;
    $('networkNodeEntity').hidden = options.length === 0;
    $('networkNodeForm').querySelector('[type="submit"]').disabled = options.length === 0;
    $('networkNodeDialog').showModal();
  }
  async function saveNetworkNode(event) {
    event.preventDefault();
    const button = event.submitter || $('networkNodeForm').querySelector('[type="submit"]'); button.disabled = true;
    try {
      const [node_type, node_id] = $('networkNodeEntity').value.split(':');
      if (!node_type || !node_id) throw new Error('Choose a record to add.');
      const existingCount = [...state.networkLayouts.keys()].filter(key => key.startsWith(`${state.activeNetworkChartId}:`)).length;
      const row = { chart_id: state.activeNetworkChartId, node_type, node_id, x: 170 + (existingCount % 4) * 245, y: node_type === 'person' ? 125 + Math.floor(existingCount / 4) * 150 : node_type === 'home' ? 335 + Math.floor(existingCount / 4) * 150 : 545 + Math.floor(existingCount / 4) * 150, note: null, icon: null };
      await request('vessel_network_nodes?on_conflict=chart_id,node_type,node_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      $('networkNodeDialog').close(); await loadData(); $('networkEditStatus').textContent = 'Record added to this chart.';
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
  }
  function openNetworkLink(link = null, endpoints = {}) {
    if (!state.networkSchemaReady) { alert('Run supabase-vessel-island-charts.sql in Supabase before adding connections.'); return; }
    if (!state.activeNetworkChartId) { alert('Choose or create an island chart first.'); return; }
    const options = networkEntities().filter(item => !item.data.recordOnly && state.networkLayouts.has(networkLayoutKey(state.activeNetworkChartId, item.type, item.id))).map(item => ({ value: networkKey(item.type, item.id), label: `${item.type === 'person' ? 'Person' : item.type === 'home' ? 'Home' : 'Vessel'} · ${item.type === 'person' ? item.data.full_name : item.data.name}` }));
    const markup = '<option value="">Choose a node</option>' + options.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('');
    $('networkLinkSource').innerHTML = markup; $('networkLinkTarget').innerHTML = markup;
    const anchorChoices = [['auto', 'Auto choose'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']];
    for (const [id, title] of [['networkLinkSourceAnchor', 'Leave from'], ['networkLinkTargetAnchor', 'Enter at']]) {
      let control = $(id);
      if (!control) {
        const label = document.createElement('label'); label.textContent = title;
        control = document.createElement('select'); control.id = id;
        anchorChoices.forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; control.append(option); });
        label.append(control); const relationship = $('networkLinkLabel').closest('.form-row'); relationship.parentNode.insertBefore(label, relationship);
      }
      control.value = link?.[id === 'networkLinkSourceAnchor' ? 'source_anchor' : 'target_anchor'] || 'auto';
    }
    $('networkLinkId').value = link?.id || ''; $('networkLinkDialogTitle').textContent = link ? 'Edit connection' : 'Add connection';
    $('networkLinkSource').value = link ? networkKey(link.source_type, link.source_id) : (endpoints.sourceKey || ''); $('networkLinkTarget').value = link ? networkKey(link.target_type, link.target_id) : (endpoints.targetKey || '');
    $('networkLinkLabel').value = link?.label || ''; $('networkLinkStyle').value = link?.line_style || 'solid'; $('networkLinkIcon').value = link?.icon || ''; $('networkLinkNote').value = link?.note || '';
    $('networkDeleteLink').hidden = !link; $('networkLinkDialog').showModal();
  }
  async function saveNetworkLink(event) {
    event.preventDefault(); const button = event.submitter || $('networkLinkForm').querySelector('[type="submit"]'); button.disabled = true;
    try {
      const [source_type, source_id] = $('networkLinkSource').value.split(':'), [target_type, target_id] = $('networkLinkTarget').value.split(':');
      if (!source_type || !target_type || !source_id || !target_id || (source_type === target_type && source_id === target_id)) throw new Error('Choose two different people, homes, or vessels.');
      const row = { chart_id: state.activeNetworkChartId, source_type, source_id, target_type, target_id, source_anchor: $('networkLinkSourceAnchor').value, target_anchor: $('networkLinkTargetAnchor').value, label: $('networkLinkLabel').value.trim() || 'Connected to', line_style: $('networkLinkStyle').value, icon: $('networkLinkIcon').value.trim() || null, note: $('networkLinkNote').value.trim() || null };
      const id = $('networkLinkId').value;
      if (id) await request(`vessel_network_links?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      else await request('vessel_network_links', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      $('networkLinkDialog').close(); await loadData(); $('networkEditStatus').textContent = 'Connection saved.';
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
  }
  let networkConnectSourceKey = '';
  async function connectNetworkCards(sourceKey, targetKey) {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    if (!networkNodeByKey(sourceKey) || !networkNodeByKey(targetKey)) { $('networkEditStatus').textContent = 'Both cards must be on this chart before connecting them.'; return; }
    networkConnectSourceKey = ''; $('networkEditStatus').textContent = '';
    openNetworkLink(null, { sourceKey, targetKey });
  }
  async function deleteNetworkLink() {
    const id = $('networkLinkId').value; if (!id || !confirm('Delete this connection?')) return;
    try { await request(`vessel_network_links?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); $('networkLinkDialog').close(); await loadData(); $('networkEditStatus').textContent = 'Connection deleted.'; }
    catch (error) { alert(error.message); }
  }
  $('networkSearch').addEventListener('input', renderNetwork); $('networkIsland').addEventListener('change', renderNetwork); $('networkChartSelect').addEventListener('change', renderNetwork);
  $('networkAddChart').addEventListener('click', async () => {
    const islandId = $('networkIsland').value, island = state.islands.find(item => item.id === islandId);
    if (!islandId || !island) { alert('Choose an island first.'); return; }
    const name = prompt(`Name the network chart for ${island.name}:`);
    if (!name?.trim()) return;
    if (name.trim().length > 100) { alert('Chart names must be 100 characters or fewer.'); return; }
    try {
      const id = createId();
      await request('vessel_network_charts', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, island_id: islandId, name: name.trim() }) });
      await loadData(); $('networkChartSelect').value = id; renderNetwork(); $('networkEditStatus').textContent = `Chart “${name.trim()}” created for ${island.name}.`;
    } catch (error) { alert(`Could not create chart: ${error.message}`); }
  });
  $('networkZoomOut').addEventListener('click', () => setNetworkZoom(state.networkZoom - 0.1));
  $('networkZoomIn').addEventListener('click', () => setNetworkZoom(state.networkZoom + 0.1));
  $('networkZoomReset').addEventListener('click', () => setNetworkZoom(1));
  let networkPinch = null;
  function touchDistance(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function touchCenter(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
  $('networkChartScroll').addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    const [a, b] = event.touches, center = touchCenter(a, b), rect = $('networkChartScroll').getBoundingClientRect();
    networkDrag = null;
    networkPinch = { distance: touchDistance(a, b), zoom: state.networkZoom, anchorX: (center.x - rect.left + $('networkChartScroll').scrollLeft) / state.networkZoom, anchorY: (center.y - rect.top + $('networkChartScroll').scrollTop) / state.networkZoom };
  }, { passive: true });
  $('networkChartScroll').addEventListener('touchmove', event => {
    if (!networkPinch || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = event.touches, center = touchCenter(a, b), rect = $('networkChartScroll').getBoundingClientRect(), viewport = $('networkChartScroll');
    setNetworkZoom(networkPinch.zoom * touchDistance(a, b) / networkPinch.distance);
    viewport.scrollLeft = networkPinch.anchorX * state.networkZoom - (center.x - rect.left);
    viewport.scrollTop = networkPinch.anchorY * state.networkZoom - (center.y - rect.top);
  }, { passive: false });
  const endNetworkPinch = event => { if (event.touches.length < 2) networkPinch = null; };
  $('networkChartScroll').addEventListener('touchend', endNetworkPinch, { passive: true });
  $('networkChartScroll').addEventListener('touchcancel', endNetworkPinch, { passive: true });
  $('networkChartScroll').addEventListener('wheel', event => { if (event.ctrlKey) { event.preventDefault(); setNetworkZoom(state.networkZoom + (event.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });
  $('networkChart').addEventListener('click', event => {
    const link = event.target.closest('[data-custom-link]'); if (link) { openNetworkLink(state.networkLinks.find(item => item.id === link.dataset.customLink)); return; }
    const node = event.target.closest('[data-network-node-key]'); if (node) { const targetKey = node.dataset.networkNodeKey; if (networkConnectSourceKey) { connectNetworkCards(networkConnectSourceKey, targetKey); return; } showNetworkNode(node); }
  });
  $('networkChart').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { const item = event.target.closest('[data-custom-link], [data-network-node-key]'); if (item) { event.preventDefault(); if (item.dataset.customLink) openNetworkLink(state.networkLinks.find(link => link.id === item.dataset.customLink)); else if (networkConnectSourceKey) connectNetworkCards(networkConnectSourceKey, item.dataset.networkNodeKey); else showNetworkNode(item); } } });
  $('networkSelection').addEventListener('submit', event => { if (event.target.id === 'networkAnnotationForm') { event.preventDefault(); saveNetworkAnnotation(event.target); } });
  $('networkSelection').addEventListener('click', event => { const profile = event.target.closest('[data-open-person-profile]'); if (profile) { openLinkedPerson(profile.dataset.openPersonProfile); return; } const edit = event.target.closest('[data-edit-home]'); if (edit) { openHome(state.homes.find(home => home.id === edit.dataset.editHome)); return; } const connect = event.target.closest('[data-connect-node]'); if (connect) { networkConnectSourceKey = connect.dataset.connectNode; $('networkEditStatus').textContent = 'Now tap the other card you want to connect.'; } });
  $('networkAddHome').addEventListener('click', () => openHome()); $('networkAddNode').addEventListener('click', openAddNetworkNode); $('networkAddLink').addEventListener('click', () => openNetworkLink());
  $('homeForm').addEventListener('submit', saveHome);
  $('networkLinkForm').addEventListener('submit', saveNetworkLink);
  $('networkNodeForm').addEventListener('submit', saveNetworkNode);
  $('networkDeleteLink').addEventListener('click', deleteNetworkLink);
  document.querySelectorAll('[data-section]').forEach(button => button.onclick = () => {
    const section = button.dataset.section; $('vesselSection').hidden = section !== 'vessels'; $('peopleSection').hidden = section !== 'people'; $('networkSection').hidden = section !== 'network';
    if (section === 'network') renderNetwork();
    document.querySelectorAll('[data-section]').forEach(nav => nav.classList.toggle('active', nav === button));
  });
  function fillSelect(select, rows, placeholder) {
    const prior = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>` + rows.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
    if (rows.some(row => row.id === prior)) select.value = prior;
  }
  async function photoUrl(path) {
    if (!path) return '';
    const response = await fetch(`${cfg.SUPABASE_URL}/storage/v1/object/sign/vessel-photos/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 3600 }) });
    if (!response.ok) throw new Error('Could not load vessel photo.');
    const data = await response.json();
    return data.signedURL.startsWith('http') ? data.signedURL : `${cfg.SUPABASE_URL}/storage/v1${data.signedURL}`;
  }
  function personPhotoOverlay(vessel) {
    const linked = [[vessel.driver_person_id, 'Driver'], [vessel.owner_person_id, 'Owner']]
      .map(([id, role]) => ({ person: state.people.find(item => item.id === id), role }))
      .filter(item => item.person?.photo_path);
    if (!linked.length) return '';
    return `<div class="vessel-people-overlay">${linked.map(({ person, role }) => `<button type="button" class="vessel-person-chip" data-person-profile="${escapeHtml(person.id)}" aria-label="View ${role} profile: ${escapeHtml(person.full_name)}"><img data-linked-person-photo="${escapeHtml(person.id)}" alt=""><span>${role}</span></button>`).join('')}</div>`;
  }
  function render() {
    const island = $('islandFilter').value; const term = $('search').value.trim().toLowerCase();
    const rows = state.vessels.filter(v => (!island || v.island_id === island) && (!term || [v.name,v.registration_no,v.driver,v.owner].some(x => (x || '').toLowerCase().includes(term)))).map(v => {
      const driver = state.people.find(p => p.id === v.driver_person_id), owner = state.people.find(p => p.id === v.owner_person_id);
      return { ...v, driver: driver?.full_name || v.driver, driver_id_number: driver?.id_number || v.driver_id_number, driver_phone: driver?.phone || v.driver_phone, owner: owner?.full_name || v.owner, owner_id_number: owner?.id_number || v.owner_id_number, owner_phone: owner?.phone || v.owner_phone };
    });
    if (!rows.length) { $('vesselGrid').innerHTML = `<div class="empty">${state.islands.length && state.types.length ? 'No vessels match. Add a vessel to get started.' : 'Add at least one island and vessel type before entering vessel records.'}</div>`; return; }
    const islandName = id => state.islands.find(x => x.id === id)?.name || 'Island';
    const typeName = id => state.types.find(x => x.id === id)?.name || 'Vessel';
    $('vesselGrid').innerHTML = rows.map(v => `<article class="vessel-card"><div class="vessel-photo">${v.photo_path ? `<img data-photo="${escapeHtml(v.id)}" alt="${escapeHtml(v.name)}" loading="lazy">` : 'No photo added'}${personPhotoOverlay(v)}</div><div class="vessel-body"><div class="vessel-title"><h3>${escapeHtml(v.name)}</h3><span class="tag">${escapeHtml(typeName(v.type_id))}</span></div><div class="vessel-data"><div><span>Registration</span><strong>${escapeHtml(v.registration_no)}</strong></div><div><span>Island</span><strong>${escapeHtml(islandName(v.island_id))}</strong></div><div><span>Driver</span><strong>${escapeHtml(v.driver || "")}</strong></div><div><span>Driver ID</span><strong>${escapeHtml(v.driver_id_number || 'Ã¢â‚¬â€')}</strong></div><div><span>Driver phone</span><strong>${escapeHtml(v.driver_phone || 'Ã¢â‚¬â€')}</strong></div><div><span>Owner</span><strong>${escapeHtml(v.owner || "")}</strong></div><div><span>Owner ID</span><strong>${escapeHtml(v.owner_id_number || 'Ã¢â‚¬â€')}</strong></div><div><span>Owner phone</span><strong>${escapeHtml(v.owner_phone || 'Ã¢â‚¬â€')}</strong></div><div><span>Engine</span><strong>${v.engine_hp == null ? 'Ã¢â‚¬â€' : `${escapeHtml(v.engine_hp)} HP`}</strong></div></div><div class="card-actions"><button class="text-button share-button" data-share="${escapeHtml(v.id)}" aria-label="Share vessel as JPG" title="Share JPG"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a3 3 0 1 0-2.83-4H15a3 3 0 0 0 .18 1L8.8 8.7a3 3 0 1 0 0 6.6l6.38 3.7A3 3 0 1 0 16 17.3l-6.38-3.7a3 3 0 0 0 0-3.2L16 6.7A3 3 0 0 0 18 8Z"/></svg></button><button class="text-button" data-edit="${escapeHtml(v.id)}">Edit</button><button class="text-button delete" data-delete="${escapeHtml(v.id)}">Delete</button></div></div></article>`).join('');
    rows.filter(v => v.photo_path).forEach(async v => { try { const url = await photoUrl(v.photo_path); const img = $('vesselGrid').querySelector(`[data-photo="${CSS.escape(v.id)}"]`); if (img) img.src = url; } catch {} });
    const linkedIds = [...new Set(rows.flatMap(v => [v.driver_person_id, v.owner_person_id]).filter(Boolean))]; linkedIds.forEach(async id => { const person = state.people.find(item => item.id === id); if (!person?.photo_path) return; try { const url = await photoUrl(person.photo_path); $('vesselGrid').querySelectorAll(`[data-linked-person-photo="${CSS.escape(id)}"]`).forEach(img => { img.src = url; }); } catch {} });
    $('vesselGrid').querySelectorAll('[data-edit]').forEach(button => button.onclick = () => openVessel(state.vessels.find(v => v.id === button.dataset.edit)));
    $('vesselGrid').querySelectorAll('[data-delete]').forEach(button => button.onclick = () => deleteVessel(button.dataset.delete));
  }
  $('vesselGrid').addEventListener('click', event => {
    const profileButton = event.target.closest('[data-person-profile]');
    if (profileButton) { openLinkedPerson(profileButton.dataset.personProfile); return; }
    const button = event.target.closest('[data-share]'); if (button) shareVesselJpg(button.dataset.share);
  });
  async function openLinkedPerson(id) {
    const person = state.people.find(item => item.id === id); if (!person) return;
    $('linkedPersonName').textContent = person.full_name || 'Person profile';
    const islandName = state.islands.find(item => item.id === person.island_id)?.name || 'Not assigned';
    const profileDetails = $('linkedPersonDialog').querySelector('.linked-person-details');
    profileDetails.innerHTML = `<div><dt>Island</dt><dd>${escapeHtml(islandName)}</dd></div><div><dt>ID number</dt><dd>${escapeHtml(person.id_number || 'Not provided')}</dd></div><div><dt>Phone number</dt><dd>${escapeHtml(person.phone || 'Not provided')}</dd></div><div><dt>Address</dt><dd>${escapeHtml(person.address || 'Not provided')}</dd></div>`;
    const image = $('linkedPersonPhoto'), initial = $('linkedPersonInitial');
    image.hidden = true; image.removeAttribute('src');
    initial.textContent = (person.full_name || '?').trim().charAt(0).toUpperCase(); initial.hidden = false;
    let assets = $('linkedPersonAssets');
    if (!assets) { assets = document.createElement('section'); assets.id = 'linkedPersonAssets'; assets.className = 'linked-person-assets'; profileDetails.after(assets); }
    const normalize = value => (value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const vessels = state.vessels.map(vessel => {
      const roles = [];
      if (vessel.driver_person_id === id || (!vessel.driver_person_id && normalize(vessel.driver) === normalize(person.full_name))) roles.push('Driver');
      if (vessel.owner_person_id === id || (!vessel.owner_person_id && normalize(vessel.owner) === normalize(person.full_name))) roles.push('Owner');
      return roles.length ? { vessel, roles } : null;
    }).filter(Boolean);
    const homeIds = new Set();
    state.networkLinks.forEach(link => {
      if (link.source_type === 'person' && link.source_id === id && link.target_type === 'home') homeIds.add(link.target_id);
      if (link.target_type === 'person' && link.target_id === id && link.source_type === 'home') homeIds.add(link.source_id);
    });
    const homes = state.homes.filter(home => homeIds.has(home.id) || home.person_id === id);
    const typeName = typeId => state.types.find(type => type.id === typeId)?.name || 'Vessel';
    const renderAsset = (kind, item, label) => `<article class="profile-asset-card"><div class="profile-asset-photo">${item.photo_path ? `<img data-profile-asset-photo="${escapeHtml(`${kind}:${item.id}`)}" alt="${escapeHtml(`${label} photo`)}" loading="lazy">` : `<span>${kind === 'home' ? 'Home' : 'Vessel'}</span>`}</div><div class="profile-asset-info"><span class="profile-asset-kind">${escapeHtml(label)}</span><h3>${escapeHtml(item.name)}</h3>${kind === 'vessel' ? `<p><span>Registration</span><strong>${escapeHtml(item.registration_no || 'Not provided')}</strong></p><p><span>Island</span><strong>${escapeHtml(state.islands.find(island => island.id === item.island_id)?.name || 'Not assigned')}</strong></p><p><span>Type</span><strong>${escapeHtml(typeName(item.type_id))}</strong></p><p><span>Engine</span><strong>${item.engine_hp == null ? 'Not provided' : `${escapeHtml(item.engine_hp)} HP`}</strong></p>` : `<p><span>Island</span><strong>${escapeHtml(state.islands.find(island => island.id === item.island_id)?.name || 'Not assigned')}</strong></p><p><span>Address</span><strong>${escapeHtml(item.address || 'Not provided')}</strong></p><div class="profile-home-gallery">${state.homePhotos.filter(photo => photo.home_id === item.id).map((photo, index) => `<img data-home-gallery-photo="${escapeHtml(photo.id)}" alt="${escapeHtml(`${item.name} photo ${index + 2}`)}" loading="lazy">`).join('')}</div><button type="button" class="secondary profile-add-home-photo" data-add-home-photos="${escapeHtml(item.id)}">+ Add photos</button>`}</div></article>`;
    assets.innerHTML = `<nav class="profile-tabs sidebar-nav" aria-label="Person profile sections"><button type="button" class="nav-link active" data-profile-tab="homes">Home photos <span class="profile-tab-count">${homes.length}</span></button><button type="button" class="nav-link" data-profile-tab="vessels">Vessels <span class="profile-tab-count">${vessels.length}</span></button></nav><section class="profile-tab-panel" data-profile-panel="homes"><div class="profile-tab-heading"><div><h3>Home photos</h3><p>Homes associated with this person</p></div><button type="button" class="secondary profile-add-home" data-add-profile-home>+ Add home photo</button></div>${homes.length ? `<div class="profile-assets-grid">${homes.map(home => renderAsset('home', home, 'Home')).join('')}</div>` : '<p class="profile-assets-empty">No home photos yet. Add a home and its photo here.</p>'}</section><section class="profile-tab-panel" data-profile-panel="vessels" hidden><div class="profile-tab-heading"><div><h3>Vessels</h3><p>Vessels linked to this person</p></div></div>${vessels.length ? `<div class="profile-assets-grid">${vessels.map(({ vessel, roles }) => renderAsset('vessel', vessel, roles.join(' / '))).join('')}</div>` : '<p class="profile-assets-empty">No vessels are linked to this person.</p>'}</section>`;
    assets.querySelectorAll('[data-profile-tab]').forEach(tab => tab.addEventListener('click', () => {
      assets.querySelectorAll('[data-profile-tab]').forEach(item => item.classList.toggle('active', item === tab));
      assets.querySelectorAll('[data-profile-panel]').forEach(panel => { panel.hidden = panel.dataset.profilePanel !== tab.dataset.profileTab; });
    }));
    assets.querySelector('[data-add-profile-home]').addEventListener('click', () => { $('linkedPersonDialog').close(); openHome(null, id); });
    assets.querySelectorAll('[data-add-home-photos]').forEach(button => button.addEventListener('click', () => {
      const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.multiple = true; picker.hidden = true;
      picker.addEventListener('change', () => addPhotosToHome(button.dataset.addHomePhotos, [...picker.files], id));
      document.body.append(picker); picker.click(); picker.addEventListener('change', () => picker.remove(), { once: true });
    }));
    $('linkedPersonDialog').showModal();
    const photos = [{ path: person.photo_path, image, onLoad: () => { image.hidden = false; initial.hidden = true; } }, ...[...homes.map(home => ({ kind: 'home', item: home })), ...vessels.map(({ vessel }) => ({ kind: 'vessel', item: vessel }))].filter(asset => asset.item.photo_path).map(asset => ({ path: asset.item.photo_path, selector: `[data-profile-asset-photo="${CSS.escape(`${asset.kind}:${asset.item.id}`)}"]` })), ...state.homePhotos.filter(photo => homes.some(home => home.id === photo.home_id)).map(photo => ({ path: photo.photo_path, selector: `[data-home-gallery-photo="${CSS.escape(photo.id)}"]` }))];
    await Promise.all(photos.filter(photo => photo.path).map(async photo => {
      try { const url = await photoUrl(photo.path); if (photo.image) { photo.image.src = url; photo.onLoad?.(); } else { const target = assets.querySelector(photo.selector); if (target) target.src = url; } } catch {}
    }));
    const homeImages = [...assets.querySelectorAll('[data-profile-asset-photo^="home:"], [data-home-gallery-photo]')].filter(photo => photo.src);
    homeImages.forEach((photo, index) => {
      photo.tabIndex = 0; photo.setAttribute('role', 'button'); photo.setAttribute('aria-label', `View home photo ${index + 1}`);
      photo.addEventListener('click', () => showHomePhotoViewer(homeImages, index));
      photo.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showHomePhotoViewer(homeImages, index); } });
    });
  }
  function showHomePhotoViewer(photos, selectedIndex) {
    let viewer = $('homePhotoViewer');
    if (!viewer) {
      viewer = document.createElement('dialog'); viewer.id = 'homePhotoViewer'; viewer.className = 'home-photo-viewer';
      viewer.innerHTML = '<button type="button" class="home-photo-close" aria-label="Close photo">×</button><button type="button" class="home-photo-prev" aria-label="Previous photo">‹</button><figure><img alt="Home photo"><figcaption></figcaption></figure><button type="button" class="home-photo-next" aria-label="Next photo">›</button>';
      document.body.append(viewer);
      viewer.querySelector('.home-photo-close').addEventListener('click', () => viewer.close());
      viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
    }
    const image = viewer.querySelector('img'), caption = viewer.querySelector('figcaption');
    const update = index => {
      const photo = photos[(index + photos.length) % photos.length]; viewer.dataset.index = String((index + photos.length) % photos.length);
      image.src = photo.src; image.alt = photo.alt || 'Home photo'; caption.textContent = `${Number(viewer.dataset.index) + 1} of ${photos.length}`;
      viewer.querySelector('.home-photo-prev').disabled = photos.length < 2; viewer.querySelector('.home-photo-next').disabled = photos.length < 2;
    };
    viewer.querySelector('.home-photo-prev').onclick = () => update(Number(viewer.dataset.index) - 1);
    viewer.querySelector('.home-photo-next').onclick = () => update(Number(viewer.dataset.index) + 1);
    update(selectedIndex); if (!viewer.open) viewer.showModal();
  }
  async function shareVesselJpg(id) {
    const vessel = state.vessels.find(v => v.id === id); if (!vessel) return;
    const island = state.islands.find(x => x.id === vessel.island_id)?.name || 'Ã¢â‚¬â€';
    const type = state.types.find(x => x.id === vessel.type_id)?.name || 'Vessel';
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f2f6f3'; ctx.fillRect(0,0,1200,1800);
    ctx.fillStyle = '#153e36'; ctx.fillRect(0,0,1200,170); ctx.fillStyle = '#fff'; ctx.font = '700 30px Arial'; ctx.fillText('VESSEL REGISTER',70,72);
    ctx.fillStyle = '#d6e9de'; ctx.font = '24px Arial'; ctx.fillText(`${island}  Ã‚Â·  ${type}`,70,118);
    const box={x:55,y:205,w:1090,h:470}; ctx.fillStyle='#dce8e0'; ctx.fillRect(box.x,box.y,box.w,box.h);
    if(vessel.photo_path){try{const photo=new Image();photo.crossOrigin='anonymous';photo.src=await photoUrl(vessel.photo_path);await new Promise((resolve,reject)=>{photo.onload=resolve;photo.onerror=reject});const scale=Math.max(box.w/photo.width,box.h/photo.height),w=photo.width*scale,h=photo.height*scale;ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();ctx.drawImage(photo,box.x+(box.w-w)/2,box.y+(box.h-h)/2,w,h);ctx.restore();}catch{ctx.fillStyle='#45665a';ctx.font='28px Arial';ctx.fillText('Photo unavailable',80,box.y+box.h/2);}}else{ctx.fillStyle='#45665a';ctx.font='28px Arial';ctx.fillText('No photo added',80,box.y+box.h/2);}
    ctx.fillStyle='#142d26';ctx.font='700 58px Arial';ctx.fillText(vessel.name,65,765,1070);ctx.fillStyle='#517162';ctx.font='28px Arial';ctx.fillText(`Registration: ${vessel.registration_no}     Island: ${island}`,68,820,1070);
    const linkedDriver = state.people.find(p => p.id === vessel.driver_person_id), linkedOwner = state.people.find(p => p.id === vessel.owner_person_id);
    const sharePortrait = async person => {
      if (!person?.photo_path) return null;
      try { const image = new Image(); image.crossOrigin = 'anonymous'; image.src = await photoUrl(person.photo_path); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; }); return image; } catch { return null; }
    };
    const [driverPortrait, ownerPortrait] = await Promise.all([sharePortrait(linkedDriver), sharePortrait(linkedOwner)]);
    const drawProfile = (person, portrait, role, fallbackName, fallbackId, fallbackPhone, x) => {
      const w = 525, photoW = 150, photoH = 158, photoX = x + (w - photoW) / 2, photoY = 905;
      ctx.fillStyle = '#45685a'; ctx.font = '700 22px Arial'; ctx.textAlign = 'center'; ctx.fillText(role.toUpperCase(), x + w / 2, 882); ctx.textAlign = 'left';
      ctx.fillStyle = '#e3ece6'; ctx.fillRect(photoX, photoY, photoW, photoH);
      if (portrait) {
        ctx.save(); ctx.beginPath(); ctx.rect(photoX, photoY, photoW, photoH); ctx.clip();
        const scale = Math.max(photoW / portrait.width, photoH / portrait.height), iw = portrait.width * scale, ih = portrait.height * scale;
        ctx.drawImage(portrait, photoX + (photoW - iw) / 2, photoY + (photoH - ih) / 2, iw, ih); ctx.restore();
      } else {
        ctx.fillStyle = '#245942'; ctx.font = '700 58px Arial'; ctx.textAlign = 'center'; ctx.fillText((person?.full_name || fallbackName || '?').trim().charAt(0).toUpperCase(), photoX + photoW / 2, photoY + 99); ctx.textAlign = 'left';
      }
      const detailsY = 1085, detailsH = 300; ctx.fillStyle = '#fff'; ctx.fillRect(x, detailsY, w, detailsH);
      const values = [['NAME', person?.full_name || fallbackName], ['ID NUMBER', person?.id_number || fallbackId], ['PHONE', person?.phone || fallbackPhone]];
      values.forEach(([label, value], index) => {
        const y = detailsY + 40 + index * 88;
        ctx.fillStyle = '#718279'; ctx.font = '700 17px Arial'; ctx.fillText(label, x + 24, y);
        ctx.fillStyle = '#182a22'; ctx.font = '600 25px Arial'; ctx.fillText(String(value || 'Not provided'), x + 24, y + 37, w - 48);
        if (index < values.length - 1) { ctx.strokeStyle = '#e6ece8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 24, y + 58); ctx.lineTo(x + w - 24, y + 58); ctx.stroke(); }
      });
    };
    drawProfile(linkedDriver, driverPortrait, 'Driver', vessel.driver, vessel.driver_id_number, vessel.driver_phone, 55);
    drawProfile(linkedOwner, ownerPortrait, 'Owner', vessel.owner, vessel.owner_id_number, vessel.owner_phone, 620);
    ctx.fillStyle = '#fff'; ctx.fillRect(55, 1435, 1090, 110); ctx.fillStyle = '#718279'; ctx.font = '700 20px Arial'; ctx.fillText('ENGINE POWER', 80, 1478); ctx.fillStyle = '#182a22'; ctx.font = '600 30px Arial'; ctx.fillText(vessel.engine_hp == null ? 'Not provided' : `${vessel.engine_hp} HP`, 80, 1520);
    ctx.fillStyle = '#72867b';ctx.font='22px Arial';ctx.fillText('Island fleet records',65,1730);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));if(!blob){alert('Could not create the JPG on this device.');return;}
    const filename=`${vessel.name.replace(/[^a-z0-9-_]+/gi,'-').replace(/^-|-$/g,'')||'vessel'}-details.jpg`,file=new File([blob],filename,{type:'image/jpeg'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:vessel.name,text:`${vessel.name} Ã‚Â· ${vessel.registration_no}`});return;}catch(error){if(error.name==='AbortError')return;}}
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);message('JPG downloaded. You can attach it in WhatsApp or another app.');
  }
  function openVessel(vessel = null) {
    $('vesselForm').reset(); $('vesselId').value = vessel?.id || ''; state.photoPath = vessel?.photo_path || null;
    $('vesselDialogTitle').textContent = vessel ? 'Edit vessel' : 'Add vessel';
    fillSelect($('vesselIsland'), state.islands, 'Choose an island'); fillSelect($('vesselType'), state.types, 'Choose a vessel type');
    if (vessel) { $('vesselName').value = vessel.name; $('registrationNo').value = vessel.registration_no; $('driverPerson').value = vessel.driver_person_id || ''; $('ownerPerson').value = vessel.owner_person_id || ''; $('driver').value = vessel.driver || ''; $('driverIdNumber').value = vessel.driver_id_number || ''; $('driverPhone').value = vessel.driver_phone || ''; $('owner').value = vessel.owner || ''; $('ownerIdNumber').value = vessel.owner_id_number || ''; $('ownerPhone').value = vessel.owner_phone || ''; $('engineHp').value = vessel.engine_hp ?? ''; $('vesselIsland').value = vessel.island_id; $('vesselType').value = vessel.type_id; }
    previewPhoto(vessel?.photo_path); $('vesselDialog').showModal();
  }
  async function previewPhoto(path) { $('photoPreview').innerHTML = path ? '<span class="hint">Loading current photoÃ¢â‚¬Â¦</span>' : ''; if (path) { try { const url = await photoUrl(path); $('photoPreview').innerHTML = `<img class="preview-image" src="${escapeHtml(url)}" alt="Current vessel photo">`; } catch { $('photoPreview').textContent = 'Current photo unavailable.'; } } }
  function fillPersonFields(selectId, nameId, idId, phoneId) {
    const person = state.people.find(p => p.id === $(selectId).value);
    $(nameId).value = person?.full_name || '';
    $(idId).value = person?.id_number || '';
    $(phoneId).value = person?.phone || '';
  }
  $('driverPerson').addEventListener('change', () => fillPersonFields('driverPerson', 'driver', 'driverIdNumber', 'driverPhone'));
  $('ownerPerson').addEventListener('change', () => fillPersonFields('ownerPerson', 'owner', 'ownerIdNumber', 'ownerPhone'));
  $('photo').addEventListener('change', () => { const file = $('photo').files[0]; if (file) { const url = URL.createObjectURL(file); $('photoPreview').innerHTML = `<img class="preview-image" src="${url}" alt="Photo preview">`; } else previewPhoto(state.photoPath); });
  async function uploadPhoto(file, vesselId) {
    if (!file) return state.photoPath;
    if (!file.type.startsWith('image/')) throw new Error('Select an image file.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Photo must be 8 MB or smaller.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${vesselId}/${Date.now()}.${ext}`;
      const { response, text } = await fetchTextWithTimeout(`${cfg.SUPABASE_URL}/storage/v1/object/vessel-photos/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: headers({ 'Content-Type': file.type, 'x-upsert': 'true' }), body: file }, 45000);
      if (!response.ok) throw new Error(text || 'Photo upload failed.');
    return path;
  }
  $('vesselForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter || $('vesselForm').querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'SavingÃ¢â‚¬Â¦';
    try {
      const id = $('vesselId').value || createId();
      const photoPath = await uploadPhoto($('photo').files[0], id);
      const row = { name: $('vesselName').value.trim(), registration_no: $('registrationNo').value.trim(), driver_person_id: $('driverPerson').value || null, owner_person_id: $('ownerPerson').value || null, driver: $('driver').value.trim() || null, driver_id_number: $('driverIdNumber').value.trim() || null, driver_phone: $('driverPhone').value.trim() || null, owner: $('owner').value.trim() || null, owner_id_number: $('ownerIdNumber').value.trim() || null, owner_phone: $('ownerPhone').value.trim() || null, engine_hp: $('engineHp').value === '' ? null : Number($('engineHp').value), island_id: $('vesselIsland').value, type_id: $('vesselType').value, photo_path: photoPath };
      if ($('vesselId').value) await request(`vessels?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      else await request('vessels', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, ...row }) });
        $('vesselDialog').close(); message('Vessel record saved.');
        loadData().catch(error => message(`Saved, but the list could not refresh: ${error.message}`, true));
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; button.textContent = 'Save vessel'; }
  });
  async function deleteVessel(id) { const vessel = state.vessels.find(v => v.id === id); if (!confirm(`Delete ${vessel?.name || 'this vessel'}?`)) return; try { await request(`vessels?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); message('Vessel deleted.'); await loadData(); } catch (error) { message(error.message, true); } }
  $('addVessel').onclick = () => { if (!state.islands.length || !state.types.length) { message('Add at least one island and vessel type first, using Ã¢â‚¬Å“Manage islands & typesÃ¢â‚¬Â.', true); return; } openVessel(); };
  $('islandFilter').onchange = render; $('search').oninput = render;
  $('manageLists').onclick = () => { renderLists(); $('listsDialog').showModal(); };
  function renderLists() {
    $('islandList').innerHTML = state.islands.map(x => `<li><span>${escapeHtml(x.name)}</span><button type="button" class="text-button delete" data-remove-island="${escapeHtml(x.id)}">Remove</button></li>`).join('') || '<li>No islands added</li>';
    $('typeList').innerHTML = state.types.map(x => `<li><span>${escapeHtml(x.name)}</span><button type="button" class="text-button delete" data-remove-type="${escapeHtml(x.id)}">Remove</button></li>`).join('') || '<li>No vessel types added</li>';
    document.querySelectorAll('[data-remove-island]').forEach(b => b.onclick = () => removeList('vessel_islands', b.dataset.removeIsland));
    document.querySelectorAll('[data-remove-type]').forEach(b => b.onclick = () => removeList('vessel_types', b.dataset.removeType));
  }
  async function addList(table, input) { const name = $(input).value.trim(); if (!name) return; try { await request(table, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ name }) }); $(input).value = ''; await loadData(); $('listsDialog').showModal(); } catch (error) { alert(error.message); } }
  $('addIsland').onclick = () => addList('vessel_islands', 'newIsland'); $('addType').onclick = () => addList('vessel_types', 'newType');
  async function removeList(table, id) { if (!confirm('Remove this entry?')) return; try { await request(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadData(); $('listsDialog').showModal(); } catch (error) { alert(error.message.includes('foreign key') || error.message.includes('violates') ? 'This item is in use. Reassign or delete its vessels first.' : error.message); } }
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
  start();
})();
