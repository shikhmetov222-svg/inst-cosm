(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { service: null, days: {}, date: null, time: null, ctype: 'telegram' };
  var DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  var DOWFULL = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function parse(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function human(ymd) { var d = parse(ymd); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + DOWFULL[d.getUTCDay()]; }
  function show(id) {
    ['s1', 's2', 's3', 's4'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    $('progress').style.width = { s1: '25%', s2: '50%', s3: '75%', s4: '100%' }[id];
    window.scrollTo(0, 0);
  }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  // Шаг 1: процедуры
  api(window.API_BASE + '/services').then(function (r) {
    var list = r.body.services || [];
    var cats = r.body.categories || [];
    if (!list.length) { $('services').innerHTML = '<div class="empty">Процедуры скоро появятся.</div>'; return; }
    function card(s) {
      var meta = esc(s.price_text) + (s.duration_known ? ' · ' + s.duration_min + ' мин' : '');
      return '<button class="card" data-id="' + s.id + '"><b>' + esc(s.name) + '</b><span>' + meta + '</span></button>';
    }
    // Группы по категориям в порядке из базы; процедуры без категории — в конце
    var groups = cats.map(function (c) {
      return { name: c.name, items: list.filter(function (s) { return s.category_id === c.id; }) };
    }).filter(function (g) { return g.items.length; });
    var loose = list.filter(function (s) { return !s.category_id || !cats.some(function (c) { return c.id === s.category_id; }); });
    if (loose.length) groups.push({ name: 'Другое', items: loose });
    $('services').innerHTML = groups.map(function (g) {
      return '<details class="cat" open><summary class="caps">' + esc(g.name) + '<i></i></summary>' + g.items.map(card).join('') + '</details>';
    }).join('');
    $('services').addEventListener('click', function (e) {
      var b = e.target.closest('.card'); if (!b) return;
      state.service = list.filter(function (s) { return String(s.id) === b.dataset.id; })[0];
      state.date = null; state.time = null;
      loadDays();
    });
  }).catch(function () { $('services').innerHTML = '<div class="empty">Не удалось загрузить. Обновите страницу.</div>'; });

  // Шаг 2: даты и время
  function loadDays() {
    $('svcLine').textContent = state.service.name + (state.service.duration_known ? ' · ' + state.service.duration_min + ' мин' : '');
    $('days').innerHTML = ''; $('times').innerHTML = '';
    $('timesBlock').classList.add('hidden'); $('noSlots').classList.add('hidden'); $('to3').disabled = true;
    show('s2');
    return api(window.API_BASE + '/availability?service=' + state.service.id).then(function (r) {
      state.days = r.body.days || {};
      var keys = Object.keys(state.days).sort();
      var any = keys.some(function (k) { return state.days[k].length; });
      $('noSlots').classList.toggle('hidden', any);
      $('days').innerHTML = keys.map(function (k) {
        var d = parse(k);
        return '<button class="day" data-d="' + k + '"' + (state.days[k].length ? '' : ' disabled') + '><small>' + DOW[d.getUTCDay()] + '</small><strong>' + d.getUTCDate() + '</strong><small>' + MONTHS[d.getUTCMonth()].slice(0, 3) + '</small></button>';
      }).join('');
      var first = keys.filter(function (k) { return state.days[k].length; })[0];
      if (first) pickDay(first);
    });
  }
  function pickDay(k) {
    state.date = k; state.time = null; $('to3').disabled = true;
    Array.prototype.forEach.call($('days').children, function (b) { b.classList.toggle('sel', b.dataset.d === k); });
    $('dateHint').textContent = human(k);
    $('times').innerHTML = state.days[k].map(function (t) { return '<button class="time" data-t="' + t + '">' + t + '</button>'; }).join('');
    $('timesBlock').classList.remove('hidden');
  }
  $('days').addEventListener('click', function (e) { var b = e.target.closest('.day'); if (b && !b.disabled) pickDay(b.dataset.d); });
  $('times').addEventListener('click', function (e) {
    var b = e.target.closest('.time'); if (!b) return;
    state.time = b.dataset.t;
    Array.prototype.forEach.call($('times').children, function (x) { x.classList.toggle('sel', x === b); });
    $('to3').disabled = false;
  });
  $('to3').addEventListener('click', function () {
    $('sum3').innerHTML = rows([['Процедура', state.service.name], ['Когда', human(state.date) + ', ' + state.time], ['Стоимость', state.service.price_text]]);
    $('err').textContent = '';
    show('s3');
  });

  // Шаг 3: контакты
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.ctype = b.dataset.type;
      document.querySelectorAll('.seg button').forEach(function (x) { x.classList.toggle('sel', x === b); });
    });
  });
  function rows(a) { return a.map(function (r) { return '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join(''); }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('name').value.trim(), contact = $('contact').value.trim();
    if (!name) { $('err').textContent = 'Укажите имя'; return; }
    if (!contact) { $('err').textContent = 'Укажите ник в Telegram или Instagram'; return; }
    $('submit').disabled = true; $('err').textContent = '';
    api(window.API_BASE + '/book', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceId: state.service.id, date: state.date, time: state.time, name: name, contact: contact, contactType: state.ctype })
    }).then(function (r) {
      $('submit').disabled = false;
      if (r.status === 200 && r.body.ok) {
        var b = r.body.booking;
        $('sum4').innerHTML = rows([['Процедура', b.service], ['Когда', b.dateHuman + ', ' + b.time], ['Длительность', b.durationMin + ' мин'], ['Стоимость', b.price]]);
        show('s4');
      } else if (r.status === 409) {
        alert('Это время только что заняли. Выберите другое.');
        loadDays();
      } else {
        $('err').textContent = r.body.message || 'Не получилось записаться. Попробуйте ещё раз.';
      }
    }).catch(function () { $('submit').disabled = false; $('err').textContent = 'Нет связи. Попробуйте ещё раз.'; });
  });

  $('again').addEventListener('click', function () { $('form').reset(); show('s1'); });
  document.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.back); }); });
  show('s1');
})();
