(() => {
  const field = document.querySelector('#profile .missionText');
  if (!field || !window.matchMedia || !window.IntersectionObserver) return;
  const original = field.querySelector('.missionStatic');
  const output = field.querySelector('.missionTyped');
  const profile = document.getElementById('profile');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sentence = original.textContent;
  let index = 0;
  let visible = false;
  let finished = false;
  let timer;
  let remaining = 300;
  let dueAt = 0;

  function pause() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, dueAt - performance.now());
  }
  function finish() {
    pause();
    finished = true;
    delete field.dataset.typing;
    output.textContent = '';
  }
  function resume() {
    if (finished || timer !== undefined || !visible || document.hidden || motion.matches || !profile.classList.contains('active')) return;
    field.dataset.typing = 'true';
    dueAt = performance.now() + remaining;
    timer = setTimeout(tick, remaining);
  }
  function tick() {
    timer = undefined;
    // Also check here in case the browser delays its media-query change event.
    if (motion.matches) { finish(); return; }
    if (document.hidden || !visible || !profile.classList.contains('active')) return;
    index += 1;
    if (index >= sentence.length) { finish(); return; }
    output.textContent = sentence.slice(0, index);
    remaining = sentence[index - 1] === ',' ? 105 : 22;
    resume();
  }
  function sync() {
    pause();
    if (motion.matches) finish(); else resume();
  }

  // One reveal, under five seconds, only while the mission is being viewed.
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= .45;
    if (visible) resume(); else pause();
  }, {threshold: .45});
  observer.observe(field);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('portfolio:sectionchange', sync);
  motion.addEventListener('change', sync);
  sync();
})();
