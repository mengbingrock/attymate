import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MatterChanges, MatterDto, MatterSnapshotDto } from '../../contracts';

const FLUSH_DEBOUNCE_MS = 600;

/** Top-level matter keys the editor can touch. */
type SectionKey = keyof MatterChanges;

type ScalarKey =
  | 'caption'
  | 'status'
  | 'matterNumber'
  | 'client'
  | 'caseNumber'
  | 'department'
  | 'currentStage';

interface RecordLike {
  id: string;
  [key: string]: unknown;
}

export interface MatterEditor {
  /** The draft the panes render: server state overlaid with unflushed edits. */
  matter: MatterDto;
  /** False renders the demo fixture read-write but persists nothing. */
  live: boolean;
  setScalar(key: ScalarKey, value: string): void;
  /** Shallow-patches an object section (statusNote, judgment fields, …). */
  patchSection(section: SectionKey, patch: Record<string, unknown>): void;
  setFieldValue(kind: 'coreFields' | 'systemFields', label: string, value: string): void;
  setNextDeadline(patch: { date?: string; label?: string }): void;
  /** Record arrays live at `matter[section]` or `matter[section][key]`. */
  updateRecord(
    section: SectionKey,
    key: string | null,
    id: string,
    patch: Record<string, unknown>
  ): void;
  addRecord(section: SectionKey, key: string | null, seed: Record<string, unknown>): string;
  removeRecord(section: SectionKey, key: string | null, id: string): void;
  /** Flushes pending edits immediately (stage switches, unmount). */
  flushNow(): void;
}

let localRecordSequence = 0;

function newLocalRecordId(): string {
  localRecordSequence += 1;
  return `rec-${Date.now().toString(36)}-${localRecordSequence.toString(36)}`;
}

function isRecordArrayHost(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readArray(matter: MatterDto, section: SectionKey, key: string | null): RecordLike[] {
  const host = key === null ? matter : (matter[section] as unknown);
  const value =
    key === null ? (matter[section] as unknown) : isRecordArrayHost(host) ? host[key] : undefined;
  return Array.isArray(value) ? (value as RecordLike[]) : [];
}

function withArray(
  matter: MatterDto,
  section: SectionKey,
  key: string | null,
  items: RecordLike[]
): MatterDto {
  if (key === null) {
    return { ...matter, [section]: items };
  }
  const host = isRecordArrayHost(matter[section])
    ? (matter[section] as Record<string, unknown>)
    : {};
  return { ...matter, [section]: { ...host, [key]: items } };
}

/**
 * Persistent inline editing for one matter. Edits apply to a local draft
 * instantly and flush to the store (debounced, whole dirty sections — the
 * store's merge semantics make object sections shallow-merge and arrays
 * replace wholesale). Server refetches never clobber unflushed edits: dirty
 * sections keep their draft values until their flush lands.
 */
export function useMatterEditor(
  teamName: string | undefined,
  serverMatter: MatterDto,
  updateMatter: (matterId: string, changes: MatterChanges) => Promise<MatterSnapshotDto | null>
): MatterEditor {
  const [draft, setDraft] = useState<MatterDto>(serverMatter);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Section → touch sequence; presence means "dirty, keep draft values".
  const dirtyRef = useRef(new Map<SectionKey, number>());
  const touchSeqRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matterIdRef = useRef(serverMatter.id);

  // Adopt server state, preserving dirty sections. A different matter id is a
  // navigation, not an echo — drop the draft entirely.
  useEffect(() => {
    if (serverMatter.id !== matterIdRef.current) {
      matterIdRef.current = serverMatter.id;
      dirtyRef.current.clear();
      setDraft(serverMatter);
      return;
    }
    setDraft((previous) => {
      const merged: MatterDto = { ...serverMatter };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const section of dirtyRef.current.keys()) {
        const draftValue = previous[section as keyof MatterDto];
        if (draftValue !== undefined) {
          mergedRecord[section] = draftValue;
        } else {
          delete mergedRecord[section];
        }
      }
      return merged;
    });
  }, [serverMatter]);

  const runFlush = useCallback((): void => {
    if (!teamName) {
      // Demo mode: local drafts only.
      dirtyRef.current.clear();
      return;
    }
    const sections = [...dirtyRef.current.entries()];
    if (sections.length === 0) return;
    const current = draftRef.current;
    const changes: Record<string, unknown> = {};
    for (const [section] of sections) {
      const value = current[section as keyof MatterDto];
      if (value !== undefined) changes[section] = value;
    }
    if (Object.keys(changes).length === 0) {
      dirtyRef.current.clear();
      return;
    }
    void updateMatter(current.id, changes as MatterChanges)
      .then(() => {
        // Only sections untouched since this flush become clean.
        for (const [section, seq] of sections) {
          if (dirtyRef.current.get(section) === seq) {
            dirtyRef.current.delete(section);
          }
        }
      })
      .catch(() => {
        // Keep sections dirty; the next edit or flush retries.
      });
  }, [teamName, updateMatter]);

  const scheduleFlush = useCallback(
    (immediate?: boolean): void => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (immediate) {
        flushTimerRef.current = null;
        runFlush();
        return;
      }
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        runFlush();
      }, FLUSH_DEBOUNCE_MS);
    },
    [runFlush]
  );

  // Unflushed edits must not die with the component.
  useEffect(
    () => () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      runFlush();
    },
    [runFlush]
  );

  const touch = useCallback(
    (
      section: SectionKey,
      mutate: (previous: MatterDto) => MatterDto,
      immediate?: boolean
    ): void => {
      touchSeqRef.current += 1;
      dirtyRef.current.set(section, touchSeqRef.current);
      setDraft((previous) => {
        const next = mutate(previous);
        draftRef.current = next;
        return next;
      });
      scheduleFlush(immediate);
    },
    [scheduleFlush]
  );

  return useMemo<MatterEditor>(
    () => ({
      matter: draft,
      live: Boolean(teamName),
      setScalar: (key, value) => {
        touch(key, (previous) => ({ ...previous, [key]: value }));
      },
      patchSection: (section, patch) => {
        touch(section, (previous) => {
          const host = isRecordArrayHost(previous[section as keyof MatterDto])
            ? (previous[section as keyof MatterDto] as Record<string, unknown>)
            : {};
          return { ...previous, [section]: { ...host, ...patch } };
        });
      },
      setFieldValue: (kind, label, value) => {
        touch(kind, (previous) => {
          const fields = Array.isArray(previous[kind]) ? previous[kind] : [];
          const exists = fields.some((field) => field.label === label);
          return {
            ...previous,
            [kind]: exists
              ? fields.map((field) => (field.label === label ? { ...field, value } : field))
              : [...fields, { label, value }],
          };
        });
      },
      setNextDeadline: (patch) => {
        touch('nextDeadline', (previous) => ({
          ...previous,
          nextDeadline: {
            date: patch.date ?? previous.nextDeadline?.date ?? '',
            label: patch.label ?? previous.nextDeadline?.label ?? '',
          },
        }));
      },
      updateRecord: (section, key, id, patch) => {
        touch(section, (previous) =>
          withArray(
            previous,
            section,
            key,
            readArray(previous, section, key).map((record) =>
              record.id === id ? { ...record, ...patch } : record
            )
          )
        );
      },
      addRecord: (section, key, seed) => {
        const id = newLocalRecordId();
        touch(
          section,
          (previous) =>
            withArray(previous, section, key, [
              ...readArray(previous, section, key),
              { id, ...seed },
            ]),
          true
        );
        return id;
      },
      removeRecord: (section, key, id) => {
        touch(
          section,
          (previous) =>
            withArray(
              previous,
              section,
              key,
              readArray(previous, section, key).filter((record) => record.id !== id)
            ),
          true
        );
      },
      flushNow: () => {
        scheduleFlush(true);
      },
    }),
    [draft, teamName, touch, scheduleFlush]
  );
}
