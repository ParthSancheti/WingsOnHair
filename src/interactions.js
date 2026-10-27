/**
 * Press feedback for explicitly opted-in controls.
 *
 * Mark a button with data-press. Its nearest .press-surface receives
 * .has-press / .has-held-press, while the button receives .is-pressed /
 * .is-held. The document element gets .is-holding during a held press.
 * Motion, blur and elevation belong in CSS; this module owns input lifecycle.
 */
export function installPressFeedback({ root = document, onHaptic = () => {}, onLongPress = () => {} } = {}) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const view = doc?.defaultView;
  const html = doc?.documentElement;
  const listeners = [];
  let active = null;
  let blockedClick = null;
  let disposed = false;

  const listen = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    listeners.push(() => target?.removeEventListener(type, handler, options));
  };

  const invoke = (callback, ...args) => {
    try { Promise.resolve(callback(...args)).catch(() => {}); }
    catch { /* Feedback must not leave an input stuck when a device API fails. */ }
  };

  function findControl(event) {
    const origin = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    const control = origin?.closest?.('[data-press]');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true' || control.closest('[inert]')) return null;
    if (root.nodeType !== 9 && !root.contains(control)) return null;
    return control;
  }

  function clearBlockedClick() {
    if (blockedClick) clearTimeout(blockedClick.timer);
    blockedClick = null;
  }

  function blockClick(press) {
    if (blockedClick?.press === press) return;
    clearBlockedClick();
    blockedClick = { press, waitingForRelease: true, timer: null };
  }

  function endBlockedSequence(kind, identifier) {
    if (!blockedClick || blockedClick.press.kind !== kind) return;
    const pressIdentifier = kind === 'pointer' ? blockedClick.press.pointerId : blockedClick.press.key;
    if (pressIdentifier !== identifier) return;
    // Native click is dispatched after pointerup/keyup. Keep this one-shot guard
    // through that dispatch, including older touch browsers' delayed click.
    blockedClick.waitingForRelease = false;
    clearTimeout(blockedClick.timer);
    blockedClick.timer = setTimeout(clearBlockedClick, 800);
  }

  function cleanPress({ cancelActivation = false } = {}) {
    if (!active) return null;
    const press = active;
    active = null;
    clearTimeout(press.timer);
    press.target.classList.remove('is-pressed', 'is-held');
    press.surface?.classList.remove('has-press', 'has-held-press');
    if (press.held) html?.classList.remove('is-holding');
    if (cancelActivation || press.held) blockClick(press);
    return press;
  }

  function beginPress(target, event, kind, identifier) {
    cleanPress({ cancelActivation: true });
    clearBlockedClick();
    const press = {
      target, event, kind, held: false,
      pointerId: kind === 'pointer' ? identifier : null,
      key: kind === 'keyboard' ? identifier : null,
      x: event.clientX ?? 0, y: event.clientY ?? 0,
      surface: target.closest('.press-surface'), timer: null,
    };
    active = press;
    target.classList.add('is-pressed');
    press.surface?.classList.add('has-press');
    invoke(onHaptic, 'light');
    press.timer = setTimeout(() => {
      if (disposed || active !== press || press.target.isConnected === false) {
        if (active === press) cleanPress({ cancelActivation: true });
        return;
      }
      press.held = true;
      press.target.classList.add('is-held');
      press.surface?.classList.add('has-held-press');
      html?.classList.add('is-holding');
      blockClick(press);
      invoke(onHaptic, 'medium');
      if (active === press) invoke(onLongPress, target, event);
    }, 420);
  }

  function pointerDown(event) {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    cleanPress({ cancelActivation: true });
    clearBlockedClick();
    const target = findControl(event);
    if (!target) return;
    beginPress(target, event, 'pointer', event.pointerId);
  }

  function pointerMove(event) {
    if (!active || active.kind !== 'pointer' || event.pointerId !== active.pointerId) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 10) cleanPress({ cancelActivation: true });
  }

  function pointerEnd(event) {
    if (active?.kind === 'pointer' && event.pointerId === active.pointerId) {
      cleanPress({ cancelActivation: event.type === 'pointercancel' });
    }
    endBlockedSequence('pointer', event.pointerId);
  }

  function pointerOut(event) {
    if (active?.kind !== 'pointer' || event.pointerId !== active.pointerId) return;
    if (!active.target.contains(event.relatedTarget)) cleanPress({ cancelActivation: true });
  }

  const activationKey = event => event.key === 'Enter' ? 'Enter' : [' ', 'Spacebar'].includes(event.key) ? ' ' : null;

  function keyDown(event) {
    const key = activationKey(event);
    if (!key || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = findControl(event);
    if (!target) return;
    // Enter normally clicks on keydown, before a long press can be recognized.
    // Own activation for both keys and synthesize exactly one short-press click.
    event.preventDefault();
    if (event.repeat || (active?.kind === 'keyboard' && active.key === key && active.target === target)) return;
    beginPress(target, event, 'keyboard', key);
  }

  function keyUp(event) {
    const key = activationKey(event);
    if (!key) return;
    if (active?.kind === 'keyboard' && active.key === key) {
      event.preventDefault();
      const press = cleanPress();
      if (!press.held && press.target.isConnected !== false && !press.target.disabled && press.target.getAttribute('aria-disabled') !== 'true') {
        press.target.click();
      }
    } else if (blockedClick?.press.kind === 'keyboard' && blockedClick.press.key === key) event.preventDefault();
    endBlockedSequence('keyboard', key);
  }

  function click(event) {
    if (!blockedClick) return;
    const { press } = blockedClick;
    if (press.kind === 'pointer') {
      // .click() and assistive-technology activation must remain functional.
      if (event.detail === 0 && (event.pointerId === undefined || event.pointerId < 0)) return;
      if (event.pointerId !== undefined && press.pointerId !== undefined && event.pointerId >= 0 && event.pointerId !== press.pointerId) return;
    } else if (!press.target.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!blockedClick.waitingForRelease) clearBlockedClick();
  }

  listen(root, 'pointerdown', pointerDown, { capture: true, passive: true });
  listen(doc, 'pointermove', pointerMove, { capture: true, passive: true });
  listen(doc, 'pointerup', pointerEnd, true);
  listen(doc, 'pointercancel', pointerEnd, true);
  listen(root, 'pointerout', pointerOut, { capture: true, passive: true });
  listen(root, 'keydown', keyDown, true);
  listen(doc, 'keyup', keyUp, true);
  listen(root, 'click', click, true);
  listen(root, 'focusout', event => {
    if (active?.kind === 'keyboard' && !active.target.contains(event.relatedTarget)) cleanPress({ cancelActivation: true });
  }, true);
  listen(view, 'blur', () => cleanPress({ cancelActivation: true }));
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cleanPress({ cancelActivation: true }); });

  return function disposePressFeedback() {
    if (disposed) return;
    disposed = true;
    cleanPress();
    clearBlockedClick();
    listeners.splice(0).forEach(remove => remove());
  };
}
