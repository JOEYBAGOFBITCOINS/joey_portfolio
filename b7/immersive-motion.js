// Presentation only: native scroll drives the story; account state stays in app.js.
(() => {
  function initialize() {
    const home = document.querySelector('#home-view');
    if (!home) return;

    const main = document.querySelector('#main') || home;
    const views = [home, document.querySelector('#dashboard-view'), document.querySelector('#build-view')].filter(Boolean);
    const journey = home.querySelector('#vault-journey');
    const membership = home.querySelector('#membership');
    const pin = journey?.querySelector('.vault-pin');
    const researchAnchor = document.getElementById('custody-research');
    const researchCard = journey?.querySelector('[data-vault-phase="2"]');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const shortViewport = matchMedia('(max-height: 599px), (max-width: 600px) and (max-height: 760px)');
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
    const revealSelector = '.depth-card, .reveal-on-scroll, .tier-peek';
    const controls = 'form, button, input, select, textarea, [contenteditable], [role="slider"], [role="spinbutton"], [role="switch"]';
    const interactive = `${controls}, a[href], summary, [role="button"], [role="tab"], [tabindex]`;
    const decorativeSelector = '#build-view .build-grid > .panel, #dashboard-view .tier-card, #dashboard-view .reserve-grid article, #dashboard-view .demo-account';
    const reveals = new Map();
    const stories = new Map();
    let frame = 0;
    let pointer = null;
    let tiltedCard = null;
    let motionEnabled = false;
    let vaultEnabled = false;
    let lastProgress = null;
    let researchIntent = false;
    let pendingResearch = null;

    const clamp = value => Math.min(1, Math.max(0, value));
    const smooth = value => {
      const t = clamp(value);
      return t * t * (3 - 2 * t);
    };
    const between = (value, start, end) => smooth((value - start) / (end - start));
    const set = (element, property, value) => element.style.setProperty(property, value);

    function researchHasFocus() {
      return document.activeElement === researchAnchor || Boolean(researchCard?.contains(document.activeElement));
    }

    function queueResearch(behavior = 'instant', focus = false) {
      if (!researchAnchor || location.hash !== '#custody-research') return;
      pendingResearch = { frames: 2, behavior, focus };
      requestUpdate();
    }

    function cancelResearchPreservation() {
      researchIntent = false;
      pendingResearch = null;
    }

    function moveResearchAnchor() {
      if (!researchAnchor || !researchCard || !pin) return;
      const parent = vaultEnabled ? journey : researchCard.parentElement;
      const next = vaultEnabled ? pin : researchCard;
      if (researchAnchor.parentElement === parent && researchAnchor.nextElementSibling === next) return;
      const focused = document.activeElement === researchAnchor;
      parent.insertBefore(researchAnchor, next);
      if (focused) researchAnchor.focus({ preventScroll: true });
    }

    function layoutChanged() {
      const preserveResearch = researchIntent && researchHasFocus();
      syncMode();
      if (preserveResearch) queueResearch();
      requestUpdate();
    }

    function requestUpdate() {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    }

    const intersectionObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(requestUpdate, { rootMargin: '120px 0px', threshold: [0, 0.15, 0.5, 1] })
      : null;

    function restoreAccessibility(card, state) {
      card.inert = state.originalInert;
      if (state.originalAria === null) card.removeAttribute('aria-hidden');
      else card.setAttribute('aria-hidden', state.originalAria);
      state.hidden = false;
    }

    function setStory(card, state, opacity, y, scale) {
      set(card, '--story-opacity', opacity.toFixed(4));
      set(card, '--story-y', `${y.toFixed(2)}px`);
      set(card, '--story-scale', scale.toFixed(4));
      const hidden = opacity <= 0.01;
      card.dataset.storyActive = String(!hidden);
      if (state.hidden === hidden) return;
      if (hidden) {
        card.inert = true;
        card.setAttribute('aria-hidden', 'true');
        state.hidden = true;
      } else {
        restoreAccessibility(card, state);
      }
    }

    function clearTilt() {
      if (!tiltedCard) return;
      set(tiltedCard, '--tilt-x', '0deg');
      set(tiltedCard, '--tilt-y', '0deg');
      set(tiltedCard, '--shine-x', '50%');
      set(tiltedCard, '--shine-y', '50%');
      tiltedCard = null;
    }

    function resetVault() {
      journey?.removeAttribute('data-vault-active');
      lastProgress = null;
      for (const [card, state] of stories) {
        setStory(card, state, 1, 0, 1);
        restoreAccessibility(card, state);
      }
    }

    function registerElements() {
      for (const [element] of reveals) {
        if (!main.contains(element)) {
          intersectionObserver?.unobserve(element);
          reveals.delete(element);
        }
      }
      for (const element of main.querySelectorAll(decorativeSelector)) {
        if (!element.matches(interactive) && !element.querySelector(interactive)) element.classList.add('depth-card');
      }
      const candidates = [...home.querySelectorAll(revealSelector), ...main.querySelectorAll(decorativeSelector)];
      for (const element of candidates) {
        if (reveals.has(element)) continue;
        if (!home.contains(element) && (element.matches(interactive) || element.querySelector(interactive))) continue;
        // Dynamic tiers are reenrolled after account rendering without changing its logic.
        if (element.classList.contains('tier-peek')) element.classList.add('depth-card');
        reveals.set(element, { progress: 0, first: true, complete: false });
        intersectionObserver?.observe(element);
      }
      for (const card of journey?.querySelectorAll('.vault-story-card[data-vault-phase]') || []) {
        if (stories.has(card)) continue;
        stories.set(card, {
          phase: Number(card.dataset.vaultPhase),
          originalAria: card.getAttribute('aria-hidden'),
          originalInert: card.inert,
          hidden: false,
        });
      }
    }

    function syncMode() {
      motionEnabled = !reducedMotion.matches;
      const nextVaultEnabled = Boolean(journey && motionEnabled && !home.hidden && !shortViewport.matches);
      if (nextVaultEnabled !== vaultEnabled) {
        vaultEnabled = nextVaultEnabled;
        if (vaultEnabled) journey.dataset.vaultActive = 'true';
        else resetVault();
      }
      moveResearchAnchor();
      if (!motionEnabled) {
        pointer = null;
        clearTilt();
        for (const element of reveals.keys()) set(element, '--reveal-progress', '1');
      }
    }

    function update() {
      frame = 0;
      if (document.hidden) return;
      syncMode();
      // The router schedules its own scroll. Align only after the enhanced layout exists.
      if (pendingResearch && !home.hidden) {
        pendingResearch.frames -= 1;
        if (pendingResearch.frames > 0) requestUpdate();
        else {
          const navigation = pendingResearch;
          pendingResearch = null;
          if (navigation.focus) researchAnchor.focus({ preventScroll: true });
          researchAnchor.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : navigation.behavior, block: 'start' });
        }
      }
      if (!motionEnabled) return;

      const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
      // Finish geometry reads before writing transforms to avoid repeated layout work.
      const measurements = [];
      for (const [element, state] of reveals) {
        if (!state.complete) measurements.push([element, state, element.getBoundingClientRect()]);
      }
      const journeyRect = vaultEnabled ? journey.getBoundingClientRect() : null;
      const membershipRect = !home.hidden ? membership?.getBoundingClientRect() : null;
      const pointerRect = pointer && finePointer.matches && main.contains(pointer.card) && !pointer.card.closest('[hidden]')
        ? pointer.card.getBoundingClientRect()
        : null;

      if (membershipRect) {
        const depthShift = Math.max(-38, Math.min(38, (viewportHeight * 0.5 - membershipRect.top - membershipRect.height * 0.5) * 0.065));
        set(membership, '--constellation-y', `${depthShift.toFixed(2)}px`);
      }

      for (const [element, state, rect] of measurements) {
        if (!rect.height || !rect.width) continue;
        // Existing visible content never disappears when the enhancement starts.
        const initialVisible = state.first && rect.top < viewportHeight;
        const distance = Math.max(1, Math.min(rect.height * 0.65, viewportHeight * 0.24));
        const progress = initialVisible ? 1 : clamp((viewportHeight * 0.96 - rect.top) / distance);
        state.first = false;
        state.progress = Math.max(state.progress, progress);
        set(element, '--reveal-progress', smooth(state.progress).toFixed(4));
        if (state.progress >= 1) {
          state.complete = true;
          intersectionObserver?.unobserve(element);
        }
      }

      if (journeyRect) {
        const travel = Math.max(1, journeyRect.height - viewportHeight);
        const progress = clamp(-journeyRect.top / travel);
        if (progress !== lastProgress) {
          set(journey, '--vault-progress', progress.toFixed(5));
          set(journey, '--vault-scale', (1 + 1.1 * between(progress, 0, 0.55)).toFixed(5));
          const dissolve = between(progress, 0.35, 0.65);
          set(journey, '--vault-exterior-alpha', (1 - dissolve).toFixed(5));
          set(journey, '--vault-interior-alpha', dissolve.toFixed(5));
          set(journey, '--vault-interior-scale', (1.15 - 0.15 * between(progress, 0, 0.8)).toFixed(5));
          lastProgress = progress;
        }

        // Scrolling never hides a link under keyboard focus or moves focus elsewhere.
        const focusedCard = [...stories.keys()].find(card => card.contains(document.activeElement));
        for (const [card, state] of stories) {
          let opacity = 1;
          let y = 0;
          if (focusedCard) {
            opacity = card === focusedCard ? 1 : 0;
          } else if (state.phase === 0) {
            opacity = 1 - between(progress, 0.18, 0.24);
            y = -24 * (1 - opacity);
          } else if (state.phase === 1) {
            opacity = between(progress, 0.28, 0.34) * (1 - between(progress, 0.54, 0.60));
            y = (progress < 0.45 ? 28 : -24) * (1 - opacity);
          } else if (state.phase === 2) {
            opacity = between(progress, 0.64, 0.70);
            y = 28 * (1 - opacity);
          }
          setStory(card, state, opacity, y, 0.98 + opacity * 0.02);
        }
      }

      if (!pointerRect || !pointerRect.width || !pointerRect.height) {
        clearTilt();
      } else {
        if (tiltedCard !== pointer.card) clearTilt();
        tiltedCard = pointer.card;
        const x = clamp((pointer.x - pointerRect.left) / pointerRect.width);
        const y = clamp((pointer.y - pointerRect.top) / pointerRect.height);
        set(tiltedCard, '--tilt-x', `${((0.5 - y) * 8).toFixed(2)}deg`);
        set(tiltedCard, '--tilt-y', `${((x - 0.5) * 8).toFixed(2)}deg`);
        set(tiltedCard, '--shine-x', `${(x * 100).toFixed(2)}%`);
        set(tiltedCard, '--shine-y', `${(y * 100).toFixed(2)}%`);
      }
    }

    function releasePointer() {
      pointer = null;
      requestUpdate();
    }

    main.addEventListener('pointermove', event => {
      if (!motionEnabled || !finePointer.matches || event.pointerType === 'touch') return;
      const card = event.target instanceof Element ? event.target.closest('.depth-card') : null;
      if (!card || !reveals.has(card) || card.matches(controls) || card.querySelector(controls)
        || (!home.contains(card) && (card.matches(interactive) || card.querySelector(interactive)))) {
        releasePointer();
        return;
      }
      pointer = { card, x: event.clientX, y: event.clientY };
      requestUpdate();
    }, { passive: true });
    main.addEventListener('pointerleave', releasePointer, { passive: true });
    home.addEventListener('focusin', requestUpdate);
    home.addEventListener('focusout', requestUpdate);
    window.addEventListener('blur', releasePointer);
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', layoutChanged, { passive: true });
    window.visualViewport?.addEventListener('resize', layoutChanged, { passive: true });
    window.addEventListener('hashchange', () => {
      researchIntent = location.hash === '#custody-research';
      if (researchIntent) queueResearch('smooth', true);
      else pendingResearch = null;
      releasePointer();
      requestUpdate();
    });
    main.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href="#custody-research"]') : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      researchIntent = true;
      // A repeated click on the current hash does not produce a hashchange event.
      queueResearch('smooth', true);
    });
    window.addEventListener('wheel', cancelResearchPreservation, { passive: true });
    window.addEventListener('touchstart', cancelResearchPreservation, { passive: true });
    window.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelResearchPreservation();
    });
    window.addEventListener('pageshow', requestUpdate);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        pointer = null;
        clearTilt();
      } else requestUpdate();
    });

    reducedMotion.addEventListener('change', () => {
      pointer = null;
      for (const [element, state] of reveals) {
        state.first = true;
        state.progress = 0;
        state.complete = false;
        intersectionObserver?.observe(element);
      }
      layoutChanged();
    });
    shortViewport.addEventListener('change', layoutChanged);
    finePointer.addEventListener('change', releasePointer);

    const mutationObserver = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) registerElements();
      requestUpdate();
    });
    mutationObserver.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(layoutChanged);
      for (const view of views) resizeObserver.observe(view);
      if (journey) resizeObserver.observe(journey);
    }

    registerElements();
    // The CSS remains fully readable until initialization and all listeners are ready.
    for (const view of views) view.dataset.motionReady = 'true';
    update();
    if (location.hash === '#custody-research') {
      researchIntent = true;
      queueResearch('instant', true);
    }
    document.fonts?.ready.then(layoutChanged);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
