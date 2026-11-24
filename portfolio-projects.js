(() => {
  'use strict';

  const projects = document.getElementById('projects');
  const scroller = projects.querySelector('.pageScroll');
  const cards = [...projects.querySelectorAll('.projectGrid > .projectCard')];
  const sidebar = document.querySelector('.imgSide');
  const artwork = sidebar.querySelector('.imgBox');
  const defaultVideo = artwork.querySelector('video');
  const caption = sidebar.querySelector('.sideCaption b');
  const subtitle = sidebar.querySelector('.sideCaption span');
  const originalCaption = caption.textContent;
  const originalSubtitle = subtitle.textContent;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 941px)');
  const layers = new Map();
  const visibleVideos = new Set();
  const cardVideos = [...projects.querySelectorAll('.projectCard video')];
  let selected = null;
  let sidebarVisible = true;
  let framePending = false;

  function canMove() {
    return !document.hidden && !motion.matches;
  }

  function playOrPause(video, shouldPlay) {
    if (!video) return;
    if (shouldPlay && video.paused) {
      video.muted = true;
      video.play().catch(() => {});
    } else if (!shouldPlay) {
      video.pause();
    }
  }

  function syncPlayback() {
    const inProjects = projects.classList.contains('active');
    const moving = canMove();
    cardVideos.forEach(video => playOrPause(video, moving && inProjects && visibleVideos.has(video)));
    playOrPause(defaultVideo, moving && sidebarVisible && !inProjects);
    layers.forEach(layer => {
      playOrPause(layer.querySelector('video'), moving && sidebarVisible && inProjects && layer.dataset.project === selected);
    });
  }

  function retryWhenReady(video) {
    if (!video) return;
    video.addEventListener('loadeddata', syncPlayback);
    video.addEventListener('canplay', syncPlayback);
  }

  function reveal(layer) {
    layer.dataset.ready = 'true';
    if (layer.dataset.project !== selected || !projects.classList.contains('active')) return;
    layers.forEach(other => other.classList.toggle('is-current', other === layer));
    syncPlayback();
  }

  function createLayer(card) {
    const layer = document.createElement('div');
    layer.className = 'projectArtwork';
    layer.dataset.project = card.dataset.project;
    layer.setAttribute('aria-hidden', 'true');
    const media = card.querySelector('.projectMedia, .tillyFeatureMedia');
    const original = media.querySelector('video, img');

    function fallback() {
      layer.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'projectArtworkFallback';
      if (!original) {
        // The Hotdog project uses an existing illustrated text panel.
        [...media.children].forEach(child => panel.append(child.cloneNode(true)));
      } else {
        const name = document.createElement('span');
        name.textContent = card.querySelector('h3').textContent.trim();
        panel.append(name);
      }
      layer.append(panel);
      reveal(layer);
    }

    layers.set(card.dataset.project, layer);
    artwork.append(layer);
    if (original?.tagName === 'VIDEO') {
      const video = document.createElement('video');
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      if (original.poster) video.poster = original.poster;
      retryWhenReady(video);
      video.addEventListener('error', fallback, {once:true});
      video.src = original.getAttribute('src') || original.querySelector('source').getAttribute('src');
      layer.append(video);
      // Mobile browsers may defer loadeddata until play() is requested.
      // Reveal the selected poster now so readiness cannot block playback.
      reveal(layer);
    } else if (original?.tagName === 'IMG') {
      const image = new Image();
      image.alt = '';
      image.addEventListener('load', () => reveal(layer), {once:true});
      image.addEventListener('error', fallback, {once:true});
      image.src = original.currentSrc || original.src;
      layer.append(image);
      if (image.complete && image.naturalWidth) reveal(layer);
    } else {
      fallback();
    }
    return layer;
  }

  function selectCard(card) {
    if (selected === card.dataset.project) {
      syncPlayback();
      return;
    }
    selected = card.dataset.project;
    const name = card.querySelector('h3').textContent.trim();
    sidebar.dataset.project = selected;
    sidebar.classList.add('is-project-view');
    caption.textContent = name;
    subtitle.textContent = `Project ${String(cards.indexOf(card) + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
    cards.forEach(item => item.classList.toggle('is-viewed', item === card));
    const layer = layers.get(selected) || createLayer(card);
    if (layer.dataset.ready === 'true') reveal(layer);
    syncPlayback();
  }

  function restoreProfileArtwork() {
    selected = null;
    delete sidebar.dataset.project;
    sidebar.classList.remove('is-project-view');
    caption.textContent = originalCaption;
    subtitle.textContent = originalSubtitle;
    layers.forEach(layer => layer.classList.remove('is-current'));
    cards.forEach(card => card.classList.remove('is-viewed'));
    syncPlayback();
  }

  function updateProjectInView() {
    framePending = false;
    if (!projects.classList.contains('active')) {
      restoreProfileArtwork();
      return;
    }
    const bounds = desktop.matches ? scroller.getBoundingClientRect() : {top:0, bottom:innerHeight - 80};
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(innerHeight, bounds.bottom);
    const focusLine = top + Math.max(0, bottom - top) * 0.35;
    let closest = cards[0];
    let shortestDistance = Infinity;
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const distance = Math.max(rect.top - focusLine, focusLine - rect.bottom, 0);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        closest = card;
      }
    });
    selectCard(closest);
  }

  function scheduleUpdate() {
    if (!framePending) {
      framePending = true;
      requestAnimationFrame(updateProjectInView);
    }
  }

  const visibility = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.target === sidebar) sidebarVisible = entry.isIntersecting;
      else if (entry.isIntersecting) visibleVideos.add(entry.target);
      else visibleVideos.delete(entry.target);
    });
    syncPlayback();
  }, {threshold:0.05});
  cardVideos.forEach(video => {
    video.muted = true;
    video.defaultMuted = true;
    retryWhenReady(video);
    visibility.observe(video);
  });
  retryWhenReady(defaultVideo);
  visibility.observe(sidebar);
  scroller.addEventListener('scroll', scheduleUpdate, {passive:true});
  window.addEventListener('scroll', scheduleUpdate, {passive:true});
  window.addEventListener('resize', scheduleUpdate, {passive:true});
  projects.addEventListener('toggle', scheduleUpdate, true);
  // Keep play() in the same user gesture that selects a section or retries it.
  document.addEventListener('portfolio:sectionchange', updateProjectInView);
  ['click', 'touchend', 'keydown'].forEach(type => {
    document.addEventListener(type, updateProjectInView, {passive:true});
  });
  window.addEventListener('pageshow', updateProjectInView);
  document.addEventListener('visibilitychange', syncPlayback);
  motion.addEventListener('change', syncPlayback);
  new ResizeObserver(scheduleUpdate).observe(scroller);
  document.fonts.ready.then(scheduleUpdate);
  updateProjectInView();
})();
