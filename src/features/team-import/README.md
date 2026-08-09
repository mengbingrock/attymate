# Team Import

Desktop-only feature for reviewing a local Claude-style agent folder and creating a draft team.

The renderer never submits a filesystem path. The main-process adapter opens the native folder
picker and inspects that selected directory in one operation. Source reads reject symbolic links,
stay inside the selected real path, and enforce file-count and byte budgets.

## Three ways a folder is read

| Source | Trigger | Fidelity |
| --- | --- | --- |
| `team-import-bundle.json` at the folder root | non-smart import, file present | full — members, roles, models, agent files, and skills, with no model call |
| Markdown scan (`agents/*.md` or `.claude/agents/*.md`, `TEAM.md`, `.claude/CLAUDE.md`, or `CLAUDE.md`, `skills/<slug>/SKILL.md` or `.claude/skills/<slug>/SKILL.md`) | non-smart import, no bundle | names, roles (from `description:`), skills, and workflow text; no agent files written, no skills installed |
| LLM parse of a whole-folder text dump | "Smart parse" checkbox, or a URL | full, but slow and non-deterministic |

The bundle is what [team-export](../team-export/README.md) writes, so exporting a team and
importing it back reproduces the roster exactly. A bundle that fails validation falls back to the
markdown scan with a `bundleFileDropped` warning rather than failing the import.

## An imported profile can occupy the lead runtime

The review step requires the user to select one imported profile as the team lead. That profile is
persisted separately from `members.meta.json`, launched as the existing primary lead session, and
excluded from every teammate spawn list. Its imported workflow and agent files are preserved; the
app does not create an additional `team-lead` agent. Teams created outside this flow keep the
legacy synthesized `team-lead` identity when no explicit profile is configured.

## A team's skills live in the team's own store

Imported skills are installed into the app's model-agnostic skill store, under
`<userData>/skills/teams/<team>/<slug>/` (`SkillStore`) — not into `<projectPath>/.claude/skills`
and not into the user-wide `~/.claude/skills`. That store is the team's own skill library: it
belongs to the team rather than to one runtime or one folder (a project path is a launch
parameter, and a team outlives it), and two teams that both ship a `legal-research` skill no
longer shadow one another. Runtime discovery is restored at launch by the projection service,
which points the current project's runtime-branded folders at the store. This keeps concurrent
teams in different projects isolated while the canonical copy remains independent of any one
launch folder. A caller with no team name yet (the
preview, which runs before the team is named) falls back to the shared `skills/library`.

The assignment is recorded in two places that must agree: `members.meta.json` carries each
member's `skills` slugs (the record), and `agents/<member>/{AGENT.md, claude-agent-definition.md}`
carry a copy for the agent to read. Existing slugs are never overwritten: a conflict is reported
as a skip so local edits survive.

Layer ownership:

- `contracts/` owns the IPC channels and DTOs.
- `core/domain/` owns parsing, name validation, and workflow rewriting.
- `core/application/` owns review and draft-creation use cases.
- `main/` owns Electron folder selection, bounded filesystem reads, review storage, and IPC.
- `preload/` exposes the typed feature bridge.
- `renderer/` owns the import hook and review UI.

HTTP/server mode intentionally does not expose this feature because a server-side arbitrary-path
API would violate the selected-folder authorization boundary.
