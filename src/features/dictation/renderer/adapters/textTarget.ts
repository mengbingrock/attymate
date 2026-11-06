import { EditorView } from '@codemirror/view';

type TextField = HTMLInputElement | HTMLTextAreaElement;
const INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel']);

export function getDictationTarget(element: EventTarget | null): HTMLElement | null {
  if (!(element instanceof HTMLElement) || element.closest('[data-dictation="off"], .xterm'))
    return null;
  if (element instanceof HTMLInputElement) {
    return INPUT_TYPES.has(element.type) && !element.disabled && !element.readOnly ? element : null;
  }
  if (element instanceof HTMLTextAreaElement)
    return !element.disabled && !element.readOnly ? element : null;
  const editable = element.closest<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"]'
  );
  if (!editable?.isContentEditable) return null;
  const codeView = editable.closest('.cm-editor') ? EditorView.findFromDOM(editable) : null;
  return codeView?.state.readOnly ? null : editable;
}

interface TextDestination {
  element: HTMLElement;
  label: string;
  insert(text: string): boolean;
}

function isField(element: HTMLElement): element is TextField {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

/** Pin the field and selection, and refuse to overwrite edits made during transcription. */
export function captureTextDestination(element: HTMLElement): TextDestination {
  const original = isField(element) ? element.value : element.textContent;
  const start = isField(element) ? element.selectionStart : null;
  const end = isField(element) ? element.selectionEnd : null;
  const range = !isField(element)
    ? window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0).cloneRange()
      : null
    : null;
  const codeView = element.closest('.cm-editor') ? EditorView.findFromDOM(element) : null;
  const codeSelection = codeView?.state.selection.main;
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('placeholder') ||
    'selected text field';
  return {
    element,
    label,
    insert(text) {
      if (
        !element.isConnected ||
        getDictationTarget(element) !== element ||
        (isField(element) ? element.value : element.textContent) !== original
      )
        return false;
      element.focus({ preventScroll: true });
      if (document.activeElement !== element && !element.contains(document.activeElement))
        return false;
      if (codeView && codeSelection) {
        codeView.dispatch({
          changes: { from: codeSelection.from, to: codeSelection.to, insert: text },
          selection: { anchor: codeSelection.from + text.length },
          userEvent: 'input',
        });
        return true;
      }
      if (isField(element)) {
        // Email inputs do not expose selection APIs; insert at the end there.
        if (start !== null && end !== null) element.setSelectionRange(start, end);
      } else if (range && element.contains(range.commonAncestorContainer)) {
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      } else return false;
      // Chromium's editing path preserves undo and fires the native input event
      // used by React controlled fields and rich text editors (including Tiptap).
      return document.execCommand('insertText', false, text);
    },
  };
}
