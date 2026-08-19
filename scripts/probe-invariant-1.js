/*
 * Проверка инварианта 1 против ЖИВОГО стенда.
 *
 * Инвариант 1: клиент никогда не пишет в БД. Этот скрипт пытается
 * пробиться всеми способами, какие есть у страницы, и показывает, что
 * канала не существует.
 *
 * КАК ЗАПУСТИТЬ
 *   1. Открыть задеплоенный клиент, войти в игру (нужна живая сессия).
 *   2. F12 → Console.
 *   3. Вставить этот файл целиком, Enter.
 *   4. Скопировать вывод.
 *
 * Скрипт ничего не ломает: он только пробует и сообщает. Единственное
 * побочное действие — попытка POST /battle/start, которая в M0 отвечает
 * 501 и ничего не пишет.
 *
 * Из среды разработки агент запустить это не может: *.onrender.com
 * закрыт политикой egress. Поэтому скрипт написан для запуска человеком.
 */
(async () => {
  const API = window.__API__ || document.querySelector('meta[name="api-url"]')?.content;
  const guess = API || prompt('URL сервера (например https://extramundum-server.onrender.com)');
  if (!guess) return console.error('Нужен URL сервера');
  const base = guess.replace(/\/+$/, '');

  const rows = [];
  const add = (what, result) =>
    rows.push({ попытка: what, результат: String(result).slice(0, 90) });
  const json = (r) => r.text().then((t) => `${r.status} ${t.slice(0, 70)}`);

  // 1. Есть ли у страницы вообще инструменты для работы с БД?
  const globals = Object.keys(window).filter((k) =>
    /pg|postgres|neon|sql|drizzle|knex|prisma/i.test(k),
  );
  add('драйверы БД в window', globals.length ? globals.join(', ') : 'нет ни одного');

  // 2. Не утекли ли в бандл строка подключения или движок?
  let code = '';
  for (const s of document.querySelectorAll('script[src]')) {
    try {
      code += await (await fetch(s.src)).text();
    } catch {
      /* пропускаем */
    }
  }
  add(
    'строка подключения в коде страницы',
    /postgres(ql)?:\/\//.test(code) ? 'НАЙДЕНА — это провал' : 'нет',
  );
  add('адрес neon.tech в коде страницы', /neon\.tech/.test(code) ? 'НАЙДЕН — это провал' : 'нет');
  add(
    'маркер боевого движка',
    code.includes('EXTRA MUNDUM_SIM_MUST_NEVER') ? 'НАЙДЕН — это провал' : 'нет',
  );
  add(
    'следы drizzle / better-auth',
    /drizzle|better-auth/.test(code) ? 'НАЙДЕНЫ — это провал' : 'нет',
  );

  // 3. Есть ли эндпоинт, принимающий состояние игрока?
  for (const [method, path, body] of [
    ['POST', '/me', { gold: 999999 }],
    ['PUT', '/me', { gold: 999999 }],
    ['PATCH', '/me', { level: 40 }],
    ['POST', '/players', { gold: 999999 }],
    ['POST', '/gold', { amount: 999999 }],
    ['POST', '/admin/grant', { gold: 999999 }],
  ]) {
    try {
      const r = await fetch(base + path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      add(`${method} ${path}`, await json(r));
    } catch (e) {
      add(`${method} ${path}`, 'запрос отвергнут браузером: ' + e);
    }
  }

  // 4. Единственный существующий POST — с подсунутым состоянием.
  const before = await (await fetch(base + '/me', { credentials: 'include' })).json();
  add('золото ДО попытки', before?.player?.gold);

  const attack = await fetch(base + '/battle/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zone: 'wastes',
      difficulty: 'normal',
      loadoutHash: 'a'.repeat(64),
      gold: 999999,
      level: 40,
      xp: 1000000,
      elo: 9999,
      exileNumber: 1,
    }),
  });
  add('POST /battle/start с золотом в теле', await json(attack));

  const after = await (await fetch(base + '/me', { credentials: 'include' })).json();
  add('золото ПОСЛЕ попытки', after?.player?.gold);
  add('уровень ПОСЛЕ попытки', after?.player?.level);
  add('номер изгнанного', after?.player?.exileNumber);

  // 5. Подделка личности.
  add('кто я по мнению сервера', after?.player?.username);
  const forged = await (
    await fetch(base + '/me?username=Гром&playerId=00000000-0000-0000-0000-000000000000&userId=1', {
      credentials: 'include',
    })
  ).json();
  add('кто я, если подсунуть чужой id', forged?.player?.username);

  // 6. Кука сессии.
  add(
    'кука сессии видна из JS',
    document.cookie.includes('session') ? document.cookie.slice(0, 50) : 'нет (httpOnly)',
  );

  console.table(rows);
  console.log(
    'Ожидаемо: 404 на все несуществующие пути, 501 на battle/start, золото и уровень не изменились, имя своё.',
  );
})();
