// The decorative gold background plays only when it is visible and motion is welcome.
const video = document.querySelector('#gold-rain-video');
if (video) {
  const hero = video.closest('.legacy-hero');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  let inView = false;
  let loaded = false;

  function updatePlayback() {
    const canPlay = inView && !document.hidden && !reducedMotion.matches && !connection?.saveData;
    if (!canPlay) {
      video.pause();
      if (reducedMotion.matches && loaded) {
        // Return to the poster and release the video when the OS motion preference changes.
        video.removeAttribute('src');
        video.load();
        loaded = false;
      }
      return;
    }
    if (!loaded) {
      video.src = video.dataset.src;
      video.muted = true;
      loaded = true;
    }
    // Autoplay can be blocked by battery-saving or browser policy; the poster stays visible.
    video.play().catch(() => {});
  }

  const observer = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    updatePlayback();
  }, { threshold: 0.01 });
  observer.observe(hero);
  reducedMotion.addEventListener('change', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);
  connection?.addEventListener('change', updatePlayback);
}
