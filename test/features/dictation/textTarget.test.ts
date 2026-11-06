import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';

import {
  captureTextDestination,
  getDictationTarget,
} from '@features/dictation/renderer/adapters/textTarget';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('dictation destinations', () => {
  it('excludes CodeMirror read-only documents even if their DOM is contenteditable', () => {
    const parent = document.createElement('div');
    parent.className = 'cm-editor';
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    parent.append(editor);
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    vi.spyOn(EditorView, 'findFromDOM').mockReturnValue({
      state: { readOnly: true },
    } as unknown as EditorView);
    expect(getDictationTarget(editor)).toBeNull();
  });
  it('supports ordinary text fields while excluding passwords, disabled, read-only, and terminal fields', () => {
    for (const type of ['text', 'search', 'url', 'email', 'tel']) {
      const input = document.createElement('input');
      input.type = type;
      expect(getDictationTarget(input)).toBe(input);
      input.readOnly = true;
      expect(getDictationTarget(input)).toBeNull();
    }
    for (const type of ['password', 'file', 'checkbox', 'number', 'date']) {
      const input = document.createElement('input');
      input.type = type;
      expect(getDictationTarget(input)).toBeNull();
    }
    document.body.innerHTML =
      '<div class="xterm"><textarea></textarea></div><textarea data-dictation="off"></textarea>';
    document
      .querySelectorAll('textarea')
      .forEach((field) => expect(getDictationTarget(field)).toBeNull());
  });
  it('restores the selected range and uses native editing for controlled field and undo compatibility', () => {
    const field = document.createElement('textarea');
    document.body.append(field);
    field.value = 'Hello old text.';
    field.setSelectionRange(6, 9);
    const destination = captureTextDestination(field);
    const command = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
    field.setSelectionRange(0, 0);
    expect(destination.insert('new')).toBe(true);
    expect(field.selectionStart).toBe(6);
    expect(field.selectionEnd).toBe(9);
    expect(command).toHaveBeenCalledWith('insertText', false, 'new');
  });
  it('keeps the transcript out of changed, detached, or newly read-only fields', () => {
    const field = document.createElement('textarea');
    document.body.append(field);
    const destination = captureTextDestination(field);
    field.value = 'edited while waiting';
    expect(destination.insert('speech')).toBe(false);
    field.value = '';
    field.readOnly = true;
    expect(destination.insert('speech')).toBe(false);
    field.readOnly = false;
    field.remove();
    expect(destination.insert('speech')).toBe(false);
  });
});
