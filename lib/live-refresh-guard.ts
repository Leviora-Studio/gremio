// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const managedSelector = '[data-live-refresh-managed],[data-live-refresh-filter],[data-live-refresh-dirty]';
/** Client-side draft tracking. Never stores or transmits field values outside this tab. */
export class LiveRefreshGuard {
 private baselines = new Map<HTMLFormElement, string>();
 private loose = new Map<HTMLElement, string>();
 pointerDown = false;
 private snapshot(form: HTMLFormElement) {
  const values: [string, string][] = [];
  // FormData omits temporarily disabled fields, including pending Server Actions.
  // Fingerprints must remain stable while saving, including during native reset.
  for (const field of Array.from(form.elements)) {
   if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) continue;
   const name = field.name;
   if (!name || name.startsWith('$ACTION_') || name === 'revision' || field.closest(managedSelector)) continue;
   if (field instanceof HTMLInputElement) {
    if (['submit', 'button', 'reset', 'image', 'search'].includes(field.type)) continue;
    if (['radio', 'checkbox'].includes(field.type) && !field.checked) continue;
    if (field.type === 'file') {
     const files = Array.from(field.files ?? []);
     for (const file of files) values.push([name, `${file.name}:${file.size}:${file.lastModified}`]);
     if (!files.length) values.push([name, 'empty-file']);
     continue;
    }
   }
   if (field instanceof HTMLSelectElement) {
    for (const option of Array.from(field.selectedOptions)) values.push([name, option.value]);
   } else values.push([name, field.value]);
  }
  return JSON.stringify(values);
 }
 capture(target: EventTarget | null) {
  if (!(target instanceof Element) || target.closest(managedSelector) || target.matches('input[type=search]')) return;
  const editable = target.closest<HTMLElement>('[contenteditable=true]');
  if (editable && !this.loose.has(editable)) this.loose.set(editable, editable.textContent ?? '');
  const form = target.closest('form');
  if (form && !this.baselines.has(form)) this.baselines.set(form, this.snapshot(form));
 }
 change(target: EventTarget | null) {
  if (!(target instanceof HTMLElement) || target.closest(managedSelector) || target.matches('input[type=search]') || target.closest('form')) return;
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) && !this.loose.has(target)) {
   this.loose.set(target, target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.defaultValue : target.textContent ?? '');
  }
 }
 reset(form: HTMLFormElement) { this.baselines.set(form, this.snapshot(form)); }
 clear() { this.baselines.clear(); this.loose.clear(); this.pointerDown = false; }
 hasDraft() {
  if (document.querySelector('[data-live-refresh-dirty="true"]')) return true;
  for (const [form, baseline] of this.baselines) {
   if (!form.isConnected || form.closest(managedSelector)) { this.baselines.delete(form); continue; }
   if (this.snapshot(form) !== baseline) return true;
  }
  for (const [element, value] of this.loose) {
   if (!element.isConnected || element.closest(managedSelector)) { this.loose.delete(element); continue; }
   if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent) !== value) return true;
  }
  return false;
 }
 blocked() {
  if (this.pointerDown || [...document.querySelectorAll('[role="dialog"][aria-modal="true"],[data-app-popover],[role="listbox"]')].some(el => el.getClientRects().length > 0) || document.querySelector('[data-live-refresh-block="true"],[aria-busy="true"]')) return true;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches('input:not([type=hidden]):not([type=button]):not([type=submit]),textarea,select,[contenteditable=true]')) return true;
  return this.hasDraft();
 }
}
