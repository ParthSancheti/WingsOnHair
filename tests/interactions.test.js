import test from 'node:test';
import assert from 'node:assert/strict';
import { installPressFeedback } from '../src/interactions.js';

class Classes {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(doc, parent = null, attributes = {}) {
    this.ownerDocument = doc;
    this.parentElement = parent;
    this.attributes = attributes;
    this.classList = new Classes();
    this.isConnected = true;
    this.disabled = false;
    this.activations = 0;
    this.nodeType = 1;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains(element) {
    for (let current = element; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (selector === '.press-surface' && current.classList.contains('press-surface')) return current;
      if (selector === '[data-press]' && 'data-press' in current.attributes) return current;
      if (selector === '[inert]' && 'inert' in current.attributes) return current;
    }
    return null;
  }
  click() {
    const event = dispatch(this.ownerDocument, 'click', this, { detail: 0 });
    if (!event.defaultPrevented) this.activations++;
  }
}

function dispatch(receiver, type, target, properties = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries({ target, ...properties })) Object.defineProperty(event, name, { value });
  receiver.dispatchEvent(event);
  return event;
}

function setup(t, onLongPress) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = new EventTarget();
  doc.nodeType = 9;
  doc.defaultView = new EventTarget();
  doc.documentElement = new Element(doc);
  const surface = new Element(doc, doc.documentElement);
  surface.classList.add('press-surface');
  const button = new Element(doc, surface, { 'data-press': '' });
  const child = new Element(doc, button);
  const haptics = [];
  const holds = [];
  const dispose = installPressFeedback({
    root: doc,
    onHaptic: kind => haptics.push(kind),
    onLongPress: (target, event) => { holds.push(target); onLongPress?.(target, event); },
  });
  t.after(dispose);
  const pointer = (type, target = button, properties = {}) => dispatch(doc, type, target, { pointerId: 7, clientX: 20, clientY: 20, button: 0, isPrimary: true, ...properties });
  const keyboard = (type, key, properties = {}) => dispatch(doc, type, button, { key, ...properties });
  return { doc, surface, button, child, haptics, holds, dispose, pointer, keyboard };
}

test('a short pointer press gives immediate feedback and preserves its click', t => {
  const { button, surface, haptics, holds, pointer } = setup(t);
  const down = pointer('pointerdown');
  assert.equal(down.defaultPrevented, false);
  assert.equal(button.classList.contains('is-pressed'), true);
  assert.equal(surface.classList.contains('has-press'), true);
  assert.deepEqual(haptics, ['light']);
  pointer('pointerup');
  assert.equal(button.classList.contains('is-pressed'), false);
  assert.equal(surface.classList.contains('has-press'), false);
  assert.equal(pointer('click', button, { detail: 1 }).defaultPrevented, false);
  t.mock.timers.tick(600);
  assert.equal(holds.length, 0);
});

test('a held pointer press opens once and consumes only that gesture’s click', t => {
  const { doc, button, surface, haptics, holds, pointer } = setup(t);
  pointer('pointerdown');
  t.mock.timers.tick(419);
  assert.equal(holds.length, 0);
  t.mock.timers.tick(1);
  assert.equal(holds.length, 1);
  assert.deepEqual(haptics, ['light', 'medium']);
  assert.equal(button.classList.contains('is-held'), true);
  assert.equal(surface.classList.contains('has-held-press'), true);
  assert.equal(doc.documentElement.classList.contains('is-holding'), true);
  t.mock.timers.tick(1500);
  assert.equal(holds.length, 1);
  pointer('pointerup');
  assert.equal(doc.documentElement.classList.contains('is-holding'), false);
  assert.equal(button.classList.contains('is-held'), false);
  assert.equal(pointer('click', button, { detail: 1 }).defaultPrevented, true);
  pointer('pointerdown');
  pointer('pointerup');
  assert.equal(pointer('click', button, { detail: 1 }).defaultPrevented, false);
});

test('scroll movement cancels activation, while crossing a child icon does not', t => {
  const { button, child, pointer, holds } = setup(t);
  pointer('pointerdown', child);
  pointer('pointerout', child, { relatedTarget: button });
  assert.equal(button.classList.contains('is-pressed'), true);
  pointer('pointermove', button, { clientX: 31 });
  assert.equal(button.classList.contains('is-pressed'), false);
  t.mock.timers.tick(500);
  assert.equal(holds.length, 0);
  pointer('pointerup');
  assert.equal(pointer('click', button, { detail: 1 }).defaultPrevented, true);
});

test('a hold stays click-safe when its callback removes the original control', t => {
  const { doc, button, pointer, holds } = setup(t, target => { target.isConnected = false; });
  pointer('pointerdown');
  t.mock.timers.tick(420);
  assert.equal(holds.length, 1);
  const sheet = new Element(doc, doc.documentElement, { 'data-press': '' });
  pointer('pointerup', sheet);
  assert.equal(pointer('click', sheet, { detail: 1 }).defaultPrevented, true);
  assert.equal(button.classList.contains('is-pressed'), false);
  assert.equal(doc.documentElement.classList.contains('is-holding'), false);
});

test('Space and Enter activate once on release, but holding either avoids selection', t => {
  const { button, keyboard, holds, haptics } = setup(t);
  for (const key of [' ', 'Enter']) {
    const before = button.activations;
    assert.equal(keyboard('keydown', key).defaultPrevented, true);
    assert.equal(button.activations, before);
    keyboard('keydown', key, { repeat: true });
    keyboard('keyup', key);
    assert.equal(button.activations, before + 1);
    keyboard('keydown', key);
    t.mock.timers.tick(420);
    keyboard('keyup', key);
    assert.equal(button.activations, before + 1);
  }
  assert.equal(holds.length, 2);
  assert.deepEqual(haptics, ['light', 'light', 'medium', 'light', 'light', 'medium']);
});

test('cancel, pointer exit, focus loss, and disposal clear pending feedback', t => {
  const { doc, button, pointer, keyboard, holds, dispose } = setup(t);
  pointer('pointerdown');
  pointer('pointercancel');
  t.mock.timers.tick(450);
  assert.equal(holds.length, 0);
  pointer('pointerdown');
  pointer('pointerout', button, { relatedTarget: doc.documentElement });
  assert.equal(button.classList.contains('is-pressed'), false);
  keyboard('keydown', ' ');
  dispatch(doc.defaultView, 'blur', doc.defaultView);
  assert.equal(button.classList.contains('is-pressed'), false);
  t.mock.timers.tick(450);
  assert.equal(holds.length, 0);
  pointer('pointerdown');
  dispose();
  dispose();
  t.mock.timers.tick(1000);
  assert.equal(holds.length, 0);
  assert.equal(button.classList.contains('is-pressed'), false);
  pointer('pointerdown');
  assert.equal(button.classList.contains('is-pressed'), false);
});

test('disabled, unmarked, secondary, and programmatic activations do not vibrate', t => {
  const { doc, button, pointer, haptics } = setup(t);
  button.disabled = true;
  pointer('pointerdown');
  button.disabled = false;
  pointer('pointerdown', button, { button: 2 });
  pointer('pointerdown', button, { isPrimary: false });
  pointer('pointerdown', new Element(doc, doc.documentElement));
  button.click();
  assert.deepEqual(haptics, []);
  assert.equal(button.activations, 1);
});
