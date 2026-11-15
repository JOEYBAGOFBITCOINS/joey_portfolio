const video = document.querySelector('#skyrx-drone-film');
const frame = document.querySelector('#drone-showcase');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let visible = false;

function updatePlayback() {
  if (visible && !frame.hidden && !document.hidden && !reduceMotion.matches) {
    video.play().catch(() => { /* The poster remains available if autoplay is blocked. */ });
  } else {
    video.pause();
    if (reduceMotion.matches && video.readyState > 0) video.currentTime = 0;
  }
}

const observer = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  updatePlayback();
}, { threshold: 0.15 });
observer.observe(frame);
new MutationObserver(updatePlayback).observe(frame, { attributes: true, attributeFilter: ['hidden'] });
reduceMotion.addEventListener('change', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
