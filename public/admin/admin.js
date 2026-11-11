(function () {
  var $ = function (id) { return document.getElementById(id); };
  var pw = ''; var data = null; var tab = 'bookings';
  var WD = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function call(body) {
    return fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': pw }, body: JSON.stringify(body) })
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
        return '<div class="box bk"><b>' + fmt(b.start_at) + ' · ' + esc(b.service_name) + '</b><span>' + esc(b.client_name) + ' · ' + esc(b.contact) + '</span><br><button class="small danger" data-cancel="' + b.id + '" style="margin-top:10px">Отменить запись</button></div>';
      }).join('') : '<div class="empty">Предстоящих записей нет.</div>');
      el.querySelectorAll('[data-cancel]').forEach(function (b) {
        b.onclick = function () { if (confirm('Отменить эту запись? Время снова станет свободным.')) call({ action: 'cancelBooking', id: b.dataset.cancel }).then(function () { flash('Запись отменена'); load(); }); };
      });
    }
    if (tab === 'services') {
      el.innerHTML = '<div id="sl">' + data.services.map(svcRow).join('') + '</div><button class="small" id="addSvc" style="width:100%;margin-bottom:12px">+ Добавить процедуру</button><button class="btn" id="saveSvc">Сохранить процедуры</button>';
      $('addSvc').onclick = function () { $('sl').insertAdjacentHTML('beforeend', svcRow({ id: '', name: '', price_text: '', duration_min: 60, active: true })); };
      $('saveSvc').onclick = function () {
        var list = Array.prototype.map.call(document.querySelectorAll('.svc'), function (r) {
          return { id: r.dataset.id || null, name: r.querySelector('.n').value, price_text: r.querySelector('.p').value, duration_min: r.querySelector('.d').value, active: r.querySelector('.a').checked };
        });
        call({ action: 'saveServices', services: list }).then(function () { flash('Сохранено'); load(); });
      };
      el.onclick = function (e) { var b = e.target.closest(".rm"); if (b && confirm('Удалить процедуру? Нажмите «Сохранить», чтобы применить.')) b.closest('.svc').remove(); };
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
  function svcRow(s) {
    return '<div class="box svc" data-id="' + esc(s.id) + '"><p class="lab">Название</p><input type="text" class="n" value="' + esc(s.name) + '"><div class="row2"><div><p class="lab">Цена (текст)</p><input type="text" class="p" value="' + esc(s.price_text) + '"></div><div><p class="lab">Минут</p><input type="number" class="d" inputmode="numeric" value="' + esc(s.duration_min) + '"></div></div><label class="chk"><input type="checkbox" class="a"' + (s.active ? ' checked' : '') + '> Показывать клиентам</label><button class="small danger rm" style="margin-top:8px">Удалить</button></div>';
  }
})();
