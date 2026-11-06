# OpenWhispr dictation

The desktop app shows a **Dictate** control beside the focused text field. Click it, speak, and click **Stop** to insert the transcript at the saved cursor or selection. Escape cancels. Messages and forms are never submitted automatically.

This reuses the installed OpenWhispr application's authenticated v1 loopback API and its downloaded local speech models. Start OpenWhispr and download a local model in its settings (Base is recommended). AttyMate does not need an API key or another speech runtime. Audio stays on the device; temporary WAV files are removed after each request.

The delegated renderer integration covers native input/textarea controls, React controlled fields, Tiptap contenteditable editors, and CodeMirror. Password, numeric/date/file, read-only, disabled, explicitly opted-out (`data-dictation="off"`), and terminal fields are excluded. A changed or removed destination produces a copyable transcript instead of overwriting newer edits. Recordings stop at two minutes.

This is intentionally a desktop-only feature: it depends on the current user's installed OpenWhispr bridge and local credential file. Browser/server mode does not expose local recording files or bridge credentials.

- `contracts/`: bridge DTOs and limits.
- `core/domain/wav.ts`: pure PCM encoding and validation.
- `main/infrastructure/`: local OpenWhispr integration and temporary audio lifecycle.
- `main/index.ts`, `preload/index.ts`: Electron registration and bridge.
- `renderer/`: recording, destination/selection handling, and the shared overlay.
- `test/features/dictation/`: audio boundary, loopback/cleanup, and field protection checks.
