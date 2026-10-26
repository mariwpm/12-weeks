(() => {
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const adminLink = document.getElementById('adminLink');
  const logoutBtn = document.getElementById('logoutBtn');

  const TOKEN_KEY = 'bbc.token';
  const USER_KEY = 'bbc.user';
  const FORM_KEY = 'bbc.bookingDraft';

  const token = () => localStorage.getItem(TOKEN_KEY);
  const user = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
  function setSession(d) { localStorage.setItem(TOKEN_KEY, d.token); localStorage.setItem(USER_KEY, JSON.stringify(d.user)); }
  function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

  function route() {
    const parts = (location.hash || '#/login').replace(/^#\//, '').split('/');
    return { name: parts[0] || 'login', parts };
  }
  const el = (html) => { app.innerHTML = html; };
  const escapeHtml = (v) => String(v || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const banner = (t, text) => `<div class="banner ${t}" role="alert">${escapeHtml(text)}</div>`;

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (token()) headers.Authorization = `Bearer ${token()}`;
    let res;
    try { res = await fetch(path, { ...options, headers }); }
    catch { const e = new Error('Нет сети. Повторите отправку.'); e.network = true; throw e; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearSession();
      const e = new Error(data.message || 'Сессия истекла.'); e.auth = true; throw e;
    }
    if (!res.ok) {
      const e = new Error(data.message || 'Ошибка запроса');
      e.status = res.status; e.payload = data; throw e;
    }
    return data;
  }

  function updateChrome() {
    const c = user();
    nav.hidden = !c;
    adminLink.hidden = !(c && c.role === 'admin');
  }
  function requireLogin() { if (!token()) { location.hash = '#/login'; return false; } return true; }

  function timeOptions(from = 8, to = 22) {
    const items = [];
    for (let h = from; h <= to; h += 1) for (const m of [0, 30]) {
      if (h === to && m > 0) continue;
      items.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
    return items;
  }
  const toIsoFromMsk = (date, hm) => new Date(`${date}T${hm}:00+03:00`).toISOString();
  const newKey = () => crypto.randomUUID();

  async function render() {
    updateChrome();
    const r = route();
    try {
      if (r.name === 'login') return renderLogin();
      if (!requireLogin()) return;
      if (r.name === 'catalog') return renderCatalog();
      if (r.name === 'resource') return renderResource(r.parts[1]);
      if (r.name === 'my') return renderMy();
      if (r.name === 'admin') return renderAdmin(r.parts[1]);
      el('<div class="card">Страница не найдена.</div>');
    } catch (err) {
      if (err.auth) { el(banner('warn', err.message) + '<p><a href="#/login">Ко входу</a></p>'); return; }
      el(banner('error', err.message || 'Ошибка загрузки.'));
    }
  }

  function renderLogin(error) {
    if (user()) { location.hash = '#/catalog'; return; }
    el(`
      <section class="card login-card">
        <h1>Вход</h1>
        <p class="lead">Учётки: <kbd>ivan</kbd>, <kbd>maria</kbd>, <kbd>admin</kbd></p>
        ${error ? banner('error', error) : ''}
        <form id="loginForm" class="grid">
          <label>Логин<input name="login" required autocomplete="username"></label>
          <label>Пароль<input name="password" type="password" required autocomplete="current-password"></label>
          <div class="actions"><button class="btn" id="loginBtn" type="submit">Войти</button></div>
        </form>
      </section>`);
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      btn.disabled = true; btn.textContent = 'Вход…';
      const fd = new FormData(e.target);
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ login: fd.get('login'), password: fd.get('password') })
        });
        setSession(data);
        location.hash = '#/catalog';
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Войти';
        renderLogin(err.message);
      }
    });
  }

  async function renderCatalog() {
    el(`
      <h1>Каталог</h1>
      <form class="filters card" id="filterForm">
        <label>Название<input name="q"></label>
        <label>Расположение<input name="location"></label>
        <button class="btn" type="submit">Найти</button>
      </form>
      <div id="list">${banner('info', 'Загрузка…')}</div>`);
    async function load() {
      const box = document.getElementById('list');
      const fd = new FormData(document.getElementById('filterForm'));
      const q = new URLSearchParams({ q: fd.get('q') || '', location: fd.get('location') || '' });
      try {
        const data = await api(`/api/resources?${q}`);
        if (!data.items.length) { box.innerHTML = '<div class="empty">Ресурсов не найдено.</div>'; return; }
        box.innerHTML = `<div class="resources">${data.items.map((r) => `
          <article class="card">
            <h2>${escapeHtml(r.name)}</h2>
            <p>${escapeHtml(r.location)}</p>
            <p class="muted">${escapeHtml(r.description)}</p>
            <a class="btn" href="#/resource/${r.id}">Открыть</a>
          </article>`).join('')}</div>`;
      } catch (err) { box.innerHTML = banner('error', err.message); }
    }
    document.getElementById('filterForm').addEventListener('submit', (e) => { e.preventDefault(); load(); });
    await load();
  }

  async function renderResource(id) {
    el(banner('info', 'Загрузка карточки…'));
    const r = await api(`/api/resources/${id}`);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
    const date = today, start = '10:00', end = '11:00';
    let draft = JSON.parse(sessionStorage.getItem(FORM_KEY) || '{}');
    if (!draft.key || draft.resourceId !== id) {
      draft = { resourceId: id, key: newKey(), date, start, end, purpose: '' };
      sessionStorage.setItem(FORM_KEY, JSON.stringify(draft));
    }
    el(`
      <p><a href="#/catalog">← Каталог</a></p>
      <h1>${escapeHtml(r.name)}</h1>
      <p>${escapeHtml(r.location)}</p>
      <p>${escapeHtml(r.description)}</p>
      ${r.isActive ? '' : banner('warn', 'Ресурс отключён.')}
      <section class="card">
        <h2>Занятые интервалы</h2>
        <label>Дата (МСК)<input type="date" id="availDate" value="${draft.date}"></label>
        <div id="occupied">${banner('info', 'Загрузка…')}</div>
      </section>
      <section class="card">
        <h2>Новая запись</h2>
        <div id="msg"></div>
        <form id="bookForm" class="grid">
          <label>Дата<input type="date" name="date" value="${draft.date}" required></label>
          <label>Начало (МСК)
            <select name="start">${timeOptions(8, 21).map((t) => `<option ${t === draft.start ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label>Окончание (МСК)
            <select name="end">${timeOptions(8, 22).map((t) => `<option ${t === draft.end ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label>Цель (5–300)<textarea name="purpose" required minlength="5" maxlength="300">${escapeHtml(draft.purpose)}</textarea></label>
          <label><input type="checkbox" name="confirm"> Подтверждаю</label>
          <div class="actions"><button class="btn" id="bookBtn" type="submit" ${r.isActive ? '' : 'disabled'}>Забронировать</button></div>
        </form>
      </section>`);

    async function loadOccupied() {
      const d = document.getElementById('availDate').value;
      const box = document.getElementById('occupied');
      try {
        const data = await api(`/api/resources/${id}/availability?date=${d}`);
        box.innerHTML = data.occupied.length
          ? `<ul class="list">${data.occupied.map((x) => `<li>${escapeHtml(x.startsAtMsk)} — ${escapeHtml(x.endsAtMsk)}</li>`).join('')}</ul>`
          : '<div class="empty">Свободно.</div>';
      } catch (err) { box.innerHTML = banner('error', err.message); }
    }
    document.getElementById('availDate').addEventListener('change', loadOccupied);
    await loadOccupied();

    const form = document.getElementById('bookForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.confirm.checked) { alert('Подтвердите данные.'); return; }
      const btn = document.getElementById('bookBtn');
      btn.disabled = true; btn.textContent = 'Отправка…';
      const fd = new FormData(form);
      const payload = {
        resourceId: id,
        startsAt: toIsoFromMsk(fd.get('date'), fd.get('start')),
        endsAt: toIsoFromMsk(fd.get('date'), fd.get('end')),
        purpose: String(fd.get('purpose') || '').trim()
      };
      const key = JSON.parse(sessionStorage.getItem(FORM_KEY) || '{}').key || newKey();
      try {
        const data = await api('/api/bookings', {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify(payload)
        });
        sessionStorage.removeItem(FORM_KEY);
        document.getElementById('msg').innerHTML =
          banner('ok', `Создано: №${data.booking.id}, ${data.booking.startsAtMsk}–${data.booking.endsAtMsk} МСК`);
        await loadOccupied();
      } catch (err) {
        document.getElementById('msg').innerHTML = banner(err.network ? 'warn' : 'error', err.message);
      } finally { btn.disabled = false; btn.textContent = 'Забронировать'; }
    });
  }

  async function renderMy() {
    el(`
      <h1>Мои записи</h1>
      <form class="filters card" id="filter">
        <label>Статус
          <select name="status">
            <option value="">Все</option>
            <option value="ACTIVE">Активно</option>
            <option value="CANCELLED">Отменено</option>
            <option value="COMPLETED">Завершено</option>
          </select>
        </label>
        <button class="btn" type="submit">Показать</button>
      </form>
      <div id="list">${banner('info', 'Загрузка…')}</div>`);
    async function load() {
      const status = document.querySelector('#filter [name=status]').value;
      const box = document.getElementById('list');
      try {
        const data = await api(`/api/bookings/my?status=${encodeURIComponent(status)}`);
        if (!data.items.length) { box.innerHTML = '<div class="empty">Записей нет.</div>'; return; }
        box.innerHTML = `<ul class="list">${data.items.map((b) => {
          const cls = b.derivedStatus === 'COMPLETED' ? 'completed' : b.status === 'CANCELLED' ? 'cancelled' : 'active';
          const label = b.derivedStatus === 'COMPLETED' ? 'Завершено' : b.status === 'CANCELLED' ? 'Отменено' : 'Активно';
          const can = b.status === 'ACTIVE' && b.derivedStatus !== 'COMPLETED' && new Date(b.startsAt) > new Date();
          return `<li>
            <strong>${escapeHtml(b.resourceName)}</strong>
            <span class="badge ${cls}">${label}</span>
            <p>${escapeHtml(b.startsAtMsk)} — ${escapeHtml(b.endsAtMsk)} МСК</p>
            <p>Цель: ${escapeHtml(b.purpose)}</p>
            ${can ? `<button class="btn danger" data-cancel="${b.id}">Отменить</button>` : ''}
          </li>`;
        }).join('')}</ul>`;
        box.querySelectorAll('[data-cancel]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Отменить запись?')) return;
            try { await api(`/api/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST', body: '{}' }); await load(); }
            catch (err) { alert(err.message); }
          });
        });
      } catch (err) { box.innerHTML = banner('error', err.message); }
    }
    document.getElementById('filter').addEventListener('submit', (e) => { e.preventDefault(); load(); });
    await load();
  }

  async function renderAdmin(tab) {
    if (!user() || user().role !== 'admin') {
      el(banner('error', 'Недостаточно прав.')); return;
    }
    const active = tab || 'resources';
    el(`
      <h1>Администрирование</h1>
      <nav class="actions">
        <a class="btn ${active === 'resources' ? '' : 'secondary'}" href="#/admin/resources">Ресурсы</a>
        <a class="btn ${active === 'bookings' ? '' : 'secondary'}" href="#/admin/bookings">Все записи</a>
        <a class="btn ${active === 'audit' ? '' : 'secondary'}" href="#/admin/audit">Аудит</a>
      </nav>
      <div id="box">${banner('info', 'Загрузка…')}</div>`);
    const box = document.getElementById('box');

    if (active === 'audit') {
      const data = await api('/api/admin/audit');
      box.innerHTML = `<div class="table-wrap card">
        <table><thead><tr><th>Время</th><th>Действие</th><th>Объект</th><th>Результат</th><th>request</th></tr></thead>
        <tbody>${data.items.map((i) => `<tr>
          <td>${escapeHtml(i.at)}</td><td>${escapeHtml(i.action)}</td>
          <td>${escapeHtml(i.objectType)} ${escapeHtml(i.objectId || '')}</td>
          <td>${escapeHtml(i.result)}</td><td>${escapeHtml(i.requestId)}</td>
        </tr>`).join('')}</tbody></table></div>`;
      return;
    }

    if (active === 'bookings') {
      const resources = await api('/api/admin/resources');
      box.innerHTML = `
        <form class="filters card" id="f">
          <label>Дата<input type="date" name="date"></label>
          <label>Ресурс<select name="resourceId"><option value="">Все</option>
            ${resources.items.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
          </select></label>
          <label>Статус<select name="status">
            <option value="">Все</option><option value="ACTIVE">Активно</option>
            <option value="CANCELLED">Отменено</option><option value="COMPLETED">Завершено</option>
          </select></label>
          <button class="btn" type="submit">Фильтр</button>
        </form>
        <div id="admList"></div>`;
      async function loadBookings() {
        const fd = new FormData(document.getElementById('f'));
        const q = new URLSearchParams({ date: fd.get('date') || '', resourceId: fd.get('resourceId') || '', status: fd.get('status') || '' });
        const data = await api(`/api/admin/bookings?${q}`);
        const host = document.getElementById('admList');
        if (!data.items.length) { host.innerHTML = '<div class="empty">Нет записей.</div>'; return; }
        host.innerHTML = data.items.map((b) => {
          const future = b.status === 'ACTIVE' && new Date(b.startsAt) > new Date();
          return `<article class="card">
            <p><strong>${escapeHtml(b.resourceName)}</strong> · ${escapeHtml(b.ownerName)}</p>
            <p>${escapeHtml(b.startsAtMsk)} — ${escapeHtml(b.endsAtMsk)} МСК</p>
            <p>Цель: ${escapeHtml(b.purpose)}</p>
            ${future ? `<form data-admin-cancel="${b.id}" class="grid">
              <label>Причина<input name="reason" required minlength="5"></label>
              <button class="btn danger" type="submit">Отменить</button>
            </form>` : ''}
          </article>`;
        }).join('');
        host.querySelectorAll('[data-admin-cancel]').forEach((form) => {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = new FormData(form).get('reason');
            try {
              await api(`/api/bookings/${form.dataset.adminCancel}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
              await loadBookings();
            } catch (err) { alert(err.message); }
          });
        });
      }
      document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); loadBookings(); });
      await loadBookings();
      return;
    }

    const data = await api('/api/admin/resources');
    box.innerHTML = `
      <form class="card grid" id="newRes">
        <h2>Новый ресурс</h2>
        <label>Название<input name="name" required></label>
        <label>Расположение<input name="location" required></label>
        <label>Описание<textarea name="description" required></textarea></label>
        <button class="btn" type="submit">Создать</button>
      </form>
      ${data.items.map((r) => `
        <form class="card grid" data-res="${r.id}">
          <h2>${escapeHtml(r.name)}</h2>
          <label>Название<input name="name" value="${escapeHtml(r.name)}" required></label>
          <label>Расположение<input name="location" value="${escapeHtml(r.location)}" required></label>
          <label>Описание<textarea name="description" required>${escapeHtml(r.description)}</textarea></label>
          <label><input type="checkbox" name="isActive" ${r.isActive ? 'checked' : ''}> Активен</label>
          <button class="btn" type="submit">Сохранить</button>
        </form>`).join('')}`;
    document.getElementById('newRes').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/admin/resources', { method: 'POST', body: JSON.stringify({
          name: fd.get('name'), location: fd.get('location'), description: fd.get('description')
        }) });
        renderAdmin('resources');
      } catch (err) { alert(err.message); }
    });
    box.querySelectorAll('[data-res]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          await api(`/api/admin/resources/${form.dataset.res}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: fd.get('name'), location: fd.get('location'),
              description: fd.get('description'), isActive: form.isActive.checked
            })
          });
          renderAdmin('resources');
        } catch (err) { alert(err.message); }
      });
    });
  }

  logoutBtn.addEventListener('click', () => { clearSession(); location.hash = '#/login'; render(); });
  window.addEventListener('hashchange', render);
  render();
})();