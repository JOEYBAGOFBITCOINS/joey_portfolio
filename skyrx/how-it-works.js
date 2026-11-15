// Local interface preview only. No submission, storage, or personal-data fields.
const form = document.querySelector('#municipal-form');
const panels = [...document.querySelectorAll('[data-step]')];
const progress = document.querySelector('#demo-progress');
const back = document.querySelector('#demo-back');
const next = document.querySelector('#demo-next');
const error = document.querySelector('#demo-error');
const complete = document.querySelector('#demo-complete');
let step = 0;

function selectedInterests() {
  return [...form.querySelectorAll('[name="interest"]:checked')].map(input => input.value);
}

function showStep(index, focus = true) {
  step = index;
  panels.forEach((panel, position) => { panel.hidden = position !== step; });
  progress.textContent = `Step ${step + 1} of 3`;
  back.hidden = step === 0;
  next.textContent = step === 2 ? 'Finish demo' : step === 1 ? 'Review demo' : 'Continue →';
  error.hidden = true;
  error.textContent = '';
  if (step === 2) {
    document.querySelector('#review-city').textContent = `${form.elements.city.value} (fictional)`;
    document.querySelector('#review-role').textContent = form.elements.role.value;
    document.querySelector('#review-interests').textContent = selectedInterests().join('; ');
  }
  if (focus) panels[step].querySelector('input, select')?.focus();
}

function showError(message, target) {
  error.textContent = message;
  error.hidden = false;
  target?.focus();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (step === 1 && selectedInterests().length === 0) {
    showError('Choose at least one area to explore in the demo.', form.querySelector('[name="interest"]'));
    return;
  }
  if (step < 2) {
    showStep(step + 1);
    return;
  }
  if (!document.querySelector('#demo-confirm').checked) {
    showError('Confirm that you understand this is a local demonstration.', document.querySelector('#demo-confirm'));
    return;
  }
  form.hidden = true;
  complete.hidden = false;
  progress.textContent = 'Preview complete';
  complete.focus({preventScroll:true});
  complete.scrollIntoView({block:'nearest'});
});

back.addEventListener('click', () => showStep(Math.max(0, step - 1)));
next.addEventListener('click', () => form.requestSubmit());
document.querySelector('#demo-restart').addEventListener('click', () => {
  form.reset();
  form.hidden = false;
  complete.hidden = true;
  showStep(0);
});

// Enable the preview only after its non-networked form handlers are attached.
panels[0].disabled = false;
next.disabled = false;

// Keep quiet, decorative loops paused when off-screen or motion is reduced.
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const videos = [...document.querySelectorAll('.concept-video')];
const visible = new Set();
function updatePlayback() {
  videos.forEach(video => {
    if (!motion.matches && !document.hidden && visible.has(video)) {
      video.play().catch(() => {});
    } else {
      video.pause();
      if (motion.matches && video.readyState > 0) video.currentTime = 0;
    }
  });
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
    updatePlayback();
  }, {threshold:0.12});
  videos.forEach(video => observer.observe(video));
}
motion.addEventListener('change', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
