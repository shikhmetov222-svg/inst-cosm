(function () {
  var $ = function (id) { return document.getElementById(id); };
  var pw = ''; var data = null; var tab = 'bookings';
  var WD = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function call(body) {
    return fetch(window.API_BASE + '/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': pw }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }
  function flash(t) { $('msg').textContent = t; setTimeout(function () { if ($('msg').textContent === t) $('msg').textContent = ''; }, 3000); }
  function load() { return call({ action: 'load' }).then(function (r) { if (r.status === 200) { data = r.body; render(); } return r; }); }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); pw = $('pw').value;
    load().then(function (r) {
      if (r.status === 200) { try { sessionStorage.setItem('zpw', pw); } catch (x) {} $('login').classList.add('hidden'); $('app').classList.remove('hidden'); }
      else $('loginErr').textContent = 'Неверный пароль';
    });
  });
  try { var saved = sessionStorage.getItem('zpw'); if (saved) { pw = saved; load().then(function (r) { if (r.status === 200) { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); } }); } } catch (x) {}

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('sel', x === b); });
    render();
  });

  function fmt(iso) {
    var d = new Date(new Date(iso).getTime() + 3 * 3600000);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }

  function render() {
    var el = $('tab');
    if (tab === 'bookings') {
      el.innerHTML = (data.bookings.length ? data.bookings.map(function (b) {
        var tel = b.phone ? '<a class="small" href="tel:' + esc(b.phone) + '" style="display:inline-flex;align-items:center;margin-top:10px;margin-right:8px;text-decoration:none;color:var(--choc)">Позвонить ' + esc(b.phone) + '</a>' : '';
        var who = [b.client_name, b.contact].filter(Boolean).map(esc).join(' · ');
        return '<div class="box bk"><b>' + fmt(b.start_at) + ' · ' + esc(b.service_name) + '</b><span>' + who + '</span><br>' + tel + '<button class="small danger" data-cancel="' + b.id + '" style="margin-top:10px">Отменить запись</button></div>';
      }).join('') : '<div class="empty">Предстоящих записей нет.</div>');
      el.querySelectorAll('[data-cancel]').forEach(function (b) {
        b.onclick = function () { if (confirm('Отменить эту запись? Время снова станет свободным.')) call({ action: 'cancelBooking', id: b.dataset.cancel }).then(function () { flash('Запись отменена'); load(); }); };
      });
    }
    if (tab === 'services') {
      var cats = data.categories || [];
      var catList = cats.map(function (c) { return { key: 'c' + c.id, name: c.name }; });
      var inCat = function (s) { return cats.some(function (c) { return c.id === s.category_id; }); };
      var blocks = cats.map(function (c) {
        return { key: 'c' + c.id, id: c.id, name: c.name, items: data.services.filter(function (s) { return s.category_id === c.id; }) };
      });
      var loose = data.services.filter(function (s) { return !inCat(s); });
      if (loose.length) blocks.push({ key: 'none', id: null, name: 'Без категории', items: loose, loose: true });
      el.innerHTML =
        '<button class="small" id="addCat" type="button" style="width:100%;margin-bottom:16px">+ Добавить категорию</button>' +
        '<div id="cats">' + blocks.map(function (b) { return catBlock(b, catList); }).join('') + '</div>' +
        '<button class="btn" id="saveSvc" type="button">Сохранить</button>';

      $('addCat').onclick = function () {
        var key = 'n' + Date.now();
        var html = catBlock({ key: key, id: null, name: '', items: [] }, domCats().concat([{ key: key, name: '' }]));
        var lb = el.querySelector('[data-cat="none"]');
        if (lb) lb.insertAdjacentHTML('beforebegin', html); else $('cats').insertAdjacentHTML('beforeend', html);
        refreshSelects();
      };
      el.onclick = function (e) {
        var t = e.target;
        if (t.closest('.rm')) { if (confirm('Удалить процедуру? Применится после «Сохранить».')) t.closest('.svc').remove(); return; }
        if (t.closest('.delcat')) {
          var box = t.closest('.catbox'); var key = box.dataset.cat;
          var used = Array.prototype.filter.call(document.querySelectorAll('.cs'), function (s) { return s.value === key; }).length;
          if (used) { alert('В этой категории есть процедуры. Сначала перенесите их: в каждой процедуре выберите другую категорию.'); return; }
          if (confirm('Удалить категорию «' + box.querySelector('.cn').value + '»?')) { box.remove(); refreshSelects(); }
          return;
        }
        if (t.closest('.addsvc')) {
          var bx = t.closest('.catbox');
          bx.querySelector('.addsvc').insertAdjacentHTML('beforebegin', svcRow({ id: '', name: '', price_text: '', duration_min: 60, duration_known: false, active: true }, bx.dataset.cat, domCats()));
        }
      };
      el.oninput = function (e) { if (e.target.classList.contains('cn')) refreshSelects(); };

      $('saveSvc').onclick = function () {
        var catsIn = domCats();
        if (catsIn.some(function (c) { return !c.name.trim(); })) { alert('У какой-то категории не написано название. Заполните его или удалите категорию.'); return; }
        var payload = catsIn.map(function (c) {
          var box = document.querySelector('.catbox[data-cat="' + c.key + '"]');
          return { id: box.dataset.id ? +box.dataset.id : null, name: c.name.trim() };
        });
        call({ action: 'saveCategories', categories: payload }).then(function (r) {
          if (r.status !== 200) { alert(r.body.message || 'Не получилось сохранить категории'); return null; }
          var idByKey = {};
          catsIn.forEach(function (c, i) { idByKey[c.key] = r.body.categories[i].id; });
          var list = Array.prototype.map.call(document.querySelectorAll('.svc'), function (row) {
            var d = row.querySelector('.d'); var key = row.querySelector('.cs').value;
            return {
              id: row.dataset.id ? +row.dataset.id : null,
              name: row.querySelector('.n').value,
              price_text: row.querySelector('.p').value,
              duration_min: d.value || 60,
              duration_known: d.value !== d.dataset.orig || row.dataset.known === '1',
              active: row.querySelector('.a').checked,
              category_id: key === 'none' ? null : (idByKey[key] || null)
            };
          });
          return call({ action: 'saveServices', services: list });
        }).then(function (r) { if (r) { flash('Сохранено'); load(); } });
      };
    }
    if (tab === 'hours') {
      var s = data.settings;
      el.innerHTML = data.hours.map(function (h) {
        return '<div class="box hr" data-wd="' + h.weekday + '"><label class="chk"><input type="checkbox" class="e"' + (h.enabled ? ' checked' : '') + '> ' + WD[h.weekday] + '</label><div class="row2"><div><p class="lab">С</p><input type="time" class="s" value="' + h.start_time.slice(0, 5) + '"></div><div><p class="lab">До</p><input type="time" class="f" value="' + h.end_time.slice(0, 5) + '"></div></div></div>';
      }).join('') +
      '<div class="box"><p class="lab">Шаг записи, минут (через сколько предлагать время)</p><input type="number" id="st" inputmode="numeric" value="' + esc(s.slot_step_min) + '"><p class="lab">На сколько дней вперёд можно записаться</p><input type="number" id="da" inputmode="numeric" value="' + esc(s.days_ahead) + '"><p class="lab">Минимум часов до записи</p><input type="number" id="mn" inputmode="numeric" value="' + esc(s.min_notice_hours) + '"></div>' +
      '<button class="btn" id="saveH">Сохранить</button>';
      $('saveH').onclick = function () {
        var hours = Array.prototype.map.call(document.querySelectorAll('.hr'), function (r) { return { weekday: +r.dataset.wd, enabled: r.querySelector('.e').checked, start_time: r.querySelector('.s').value, end_time: r.querySelector('.f').value }; });
        Promise.all([call({ action: 'saveHours', hours: hours }), call({ action: 'saveSettings', settings: { slot_step_min: $('st').value, days_ahead: $('da').value, min_notice_hours: $('mn').value } })]).then(function () { flash('Сохранено'); load(); });
      };
    }
    if (tab === 'closed') {
      el.innerHTML = '<div class="box"><p class="lab">Дата, когда вы не работаете</p><input type="date" id="cd"><input type="text" id="cn" placeholder="Заметка (необязательно)"><button class="btn" id="addC" style="margin-top:0">Закрыть дату</button></div>' +
        data.closed.map(function (c) { return '<div class="box bk"><b>' + esc(c.day.split('-').reverse().join('.')) + '</b><span>' + esc(c.note || '') + '</span><br><button class="small" data-open="' + c.day + '" style="margin-top:10px">Открыть снова</button></div>'; }).join('');
      $('addC').onclick = function () { if (!$('cd').value) return; call({ action: 'closeDate', day: $('cd').value, note: $('cn').value }).then(function () { flash('Дата закрыта'); load(); }); };
      el.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { call({ action: 'openDate', day: b.dataset.open }).then(function () { flash('Дата открыта'); load(); }); }; });
    }
  }
  // Категория блока: key 'c<id>' для сохранённых, 'n<время>' для новых, 'none' для «Без категории»
  function catBlock(b, catList) {
    var head = b.loose
      ? '<p class="caps" style="font-size:16px;color:var(--muted);margin:0 0 10px">Без категории</p>'
      : '<p class="lab">Категория</p><div class="row2"><input type="text" class="cn" value="' + esc(b.name) + '" maxlength="60"><button class="small danger delcat" type="button">Удалить</button></div>';
    return '<div class="box catbox" data-cat="' + b.key + '" data-id="' + (b.id || '') + '">' + head +
      b.items.map(function (s) { return svcRow(s, b.key, catList); }).join('') +
      '<button class="small addsvc" type="button" style="width:100%;margin-top:4px">+ Процедура</button></div>';
  }
  function svcRow(s, key, catList) {
    var known = s.duration_known !== false;
    var dur = known ? String(s.duration_min) : '';
    return '<div class="box svc" data-id="' + esc(s.id || '') + '" data-known="' + (known ? '1' : '0') + '">' +
      '<p class="lab">Название</p><input type="text" class="n" value="' + esc(s.name || '') + '">' +
      '<div class="row2"><div><p class="lab">Цена (текст)</p><input type="text" class="p" value="' + esc(s.price_text || '') + '"></div>' +
      '<div><p class="lab">Минут</p><input type="number" class="d" inputmode="numeric" placeholder="не указано" value="' + esc(dur) + '" data-orig="' + esc(dur) + '"></div></div>' +
      (known ? '' : '<p class="lab" style="color:var(--err)">Время не указано: введите минуты</p>') +
      '<p class="lab">Категория</p><select class="cs">' + optionsFor(key, catList) + '</select>' +
      '<label class="chk"><input type="checkbox" class="a"' + (s.active !== false ? ' checked' : '') + '> Показывать клиентам</label>' +
      '<button class="small danger rm" type="button" style="margin-top:8px">Удалить</button></div>';
  }
  function optionsFor(selected, catList) {
    return catList.map(function (c) {
      return '<option value="' + c.key + '"' + (c.key === selected ? ' selected' : '') + '>' + esc(c.name || 'Без названия') + '</option>';
    }).join('') + '<option value="none"' + (selected === 'none' ? ' selected' : '') + '>Без категории</option>';
  }
  // Текущий список категорий, как он сейчас на экране (с учётом новых и переименованных)
  function domCats() {
    return Array.prototype.map.call(document.querySelectorAll('.catbox[data-cat]:not([data-cat="none"])'), function (b) {
      return { key: b.dataset.cat, name: b.querySelector('.cn').value };
    });
  }
  function refreshSelects() {
    var cs = domCats();
    Array.prototype.forEach.call(document.querySelectorAll('.cs'), function (s) { s.innerHTML = optionsFor(s.value, cs); });
  }
})();
