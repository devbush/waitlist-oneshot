(() => {
  const KEY = 'waitlist:lists';
  let lists = [];
  try {
    lists = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {}
  const section = document.getElementById('my-lists');
  if (!section || !Array.isArray(lists) || !lists.length) return;

  const ul = section.querySelector('ul');
  for (const l of lists) {
    if (!l || typeof l.token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(l.token)) continue;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/admin/${l.token}`;
    const name = document.createElement('span');
    name.textContent = l.title || 'Sans titre';
    const go = document.createElement('span');
    go.textContent = 'Dashboard →';
    a.append(name, go);
    li.append(a);
    ul.append(li);
  }
  section.hidden = !ul.children.length;
})();
