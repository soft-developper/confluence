"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isAddress } from "viem";
import {
  LABEL_MAX,
  deleteAddress,
  removeRecent,
  saveAddress,
  useAddressBook,
  type SavedAddress,
} from "@/lib/addressBook";
import { shortAddress, type BridgeChain } from "@/lib/chains";
import { useIdRecipient } from "@/hooks/useIdRecipient";

const inputCls =
  "h-10 rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text";
const linkBtn = "text-[13px] font-medium text-action-text hover:underline disabled:opacity-50";

function LabelForm({ initial, onSave, onCancel }: { initial?: string; onSave: (label: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initial ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const ok = label.trim().length > 0;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(label);
      }}
    >
      <input
        ref={ref}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={LABEL_MAX}
        placeholder="Name, for example Treasury"
        aria-label="Address name"
        className={`${inputCls} min-w-0 flex-1`}
      />
      <button type="submit" disabled={!ok} className={linkBtn}>
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-[13px] text-ink-muted hover:text-ink">
        Cancel
      </button>
    </form>
  );
}

export function RecipientField({
  owner,
  value,
  onChange,
  destination,
}: {
  owner: `0x${string}` | undefined;
  value: string;
  onChange: (v: string) => void;
  destination: BridgeChain | undefined;
}) {
  const book = useAddressBook(owner);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const valid = isAddress(value);
  const label = valid ? book.labelOf(value) : undefined;
  const id = useIdRecipient(value);

  useEffect(() => {
    setSaving(false);
    setSaveError(false);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="recipient" className="text-[13px] font-medium text-ink-muted">
          Recipient on {destination?.name ?? "the destination"}
        </label>
        {owner && (
          <button type="button" onClick={() => setPickerOpen(true)} className={linkBtn}>
            Address book
          </button>
        )}
      </div>
      <input
        id="recipient"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="0x... or @confluence_id"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={value.length > 0 && !valid && !(id.isId && id.resolved)}
        className={`h-11 rounded-md border bg-bg px-3 font-mono text-xs outline-none ${
          value.length > 0 && !valid && !(id.isId && (id.resolved || id.loading || !id.wellFormed)) ? "border-danger" : "border-border-control focus:border-action-text"
        }`}
      />
      {value.length > 0 && !valid && !id.isId && <span className="text-xs text-danger">Not a valid EVM address or @confluence_id</span>}
      {id.isId && !id.wellFormed && value.length > 1 && <span className="text-xs text-ink-muted">Confluence IDs are 3 to 20 letters, digits or underscores.</span>}
      {id.isId && id.wellFormed && id.loading && <span className="text-xs text-ink-muted">Finding @{id.handle}...</span>}
      {id.isId && id.wellFormed && !id.loading && id.resolved === null && (
        <span className="text-xs text-danger">No Confluence ID @{id.handle}</span>
      )}
      {id.isId && id.resolved && (
        <span className="text-xs text-destination-text">
          @{id.resolved.handle} → <span className="font-mono">{shortAddress(id.resolved.address)}</span>. Confluence checks this again when quoting.
        </span>
      )}
      {valid && label && <span className="text-xs text-destination-text">Saved as {label}</span>}
      {valid && !label && owner && !saving && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-muted">Valid address, not in your address book</span>
          <button type="button" onClick={() => setSaving(true)} className={linkBtn}>
            Save
          </button>
        </div>
      )}
      {valid && !label && owner && saving && (
        <LabelForm
          onSave={(l) => {
            const ok = saveAddress(owner, value, l);
            setSaveError(!ok);
            if (ok) setSaving(false);
          }}
          onCancel={() => setSaving(false)}
        />
      )}
      {saveError && <span className="text-xs text-danger">Could not save in this browser (storage is blocked or full).</span>}

      {owner && (
        <AddressBookPicker
          open={pickerOpen}
          owner={owner}
          currentValue={value}
          onSelect={(a) => {
            onChange(a);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
          saved={book.saved}
          recents={book.recents}
          labelOf={book.labelOf}
        />
      )}
    </div>
  );
}

function AddressBookPicker({
  open,
  owner,
  currentValue,
  onSelect,
  onClose,
  saved,
  recents,
  labelOf,
}: {
  open: boolean;
  owner: `0x${string}`;
  currentValue: string;
  onSelect: (address: string) => void;
  onClose: () => void;
  saved: SavedAddress[];
  recents: ReturnType<typeof useAddressBook>["recents"];
  labelOf: (a: string) => string | undefined;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // saved id or recent address
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setEditing(null);
    setConfirmDelete(null);
    searchRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const s = q.trim().toLowerCase();
  const savedList = useMemo(
    () => (s ? saved.filter((e) => e.label.toLowerCase().includes(s) || e.address.toLowerCase().includes(s)) : saved),
    [s, saved],
  );
  // Recents that are already saved show in Saved only.
  const recentList = useMemo(
    () => recents.filter((r) => !labelOf(r.address)).filter((r) => !s || r.address.toLowerCase().includes(s)),
    [s, recents, labelOf],
  );

  if (!open) return null;
  const isCurrent = (a: string) => a.toLowerCase() === currentValue.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,9,16,0.74)] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[460px] flex-col gap-4 rounded-t-lg border border-border bg-surface-raised p-6 sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="book-title" className="text-xl font-medium">
              Address book
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">Saved in this browser for {shortAddress(owner)}. The same address works on every EVM chain.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink">
            ✕
          </button>
        </div>

        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or address"
          aria-label="Search address book"
          className={inputCls}
        />

        <div className="-mx-2 flex flex-col gap-4 overflow-y-auto px-2">
          <section aria-labelledby="book-saved" className="flex flex-col gap-1">
            <h3 id="book-saved" className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Saved
            </h3>
            {savedList.length === 0 && (
              <p className="py-2 text-[13px] text-ink-muted">
                {saved.length === 0 ? "Nothing saved yet. Paste an address in the recipient field and press Save." : "No matches."}
              </p>
            )}
            {savedList.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                {editing === e.id ? (
                  <LabelForm
                    initial={e.label}
                    onSave={(l) => {
                      saveAddress(owner, e.address, l);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => onSelect(e.address)} className="flex min-w-0 flex-col items-start text-left">
                      <span className="truncate text-sm font-medium">
                        {e.label}
                        {isCurrent(e.address) && <span className="ml-2 text-xs text-destination-text">Selected</span>}
                      </span>
                      <span className="font-mono text-xs text-ink-muted">{shortAddress(e.address)}</span>
                    </button>
                    <span className="flex shrink-0 items-center gap-3">
                      <button type="button" onClick={() => setEditing(e.id)} className={linkBtn} aria-label={`Rename ${e.label}`}>
                        Rename
                      </button>
                      {confirmDelete === e.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            deleteAddress(owner, e.id);
                            setConfirmDelete(null);
                          }}
                          className="text-[13px] font-medium text-danger"
                        >
                          Confirm delete
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirmDelete(e.id)} className="text-[13px] text-ink-muted hover:text-danger" aria-label={`Delete ${e.label}`}>
                          Delete
                        </button>
                      )}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section aria-labelledby="book-recent" className="flex flex-col gap-1">
            <h3 id="book-recent" className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Recent recipients
            </h3>
            {recentList.length === 0 && (
              <p className="py-2 text-[13px] text-ink-muted">Addresses you send to from this browser appear here.</p>
            )}
            {recentList.map((r) => (
              <div key={r.address} className="flex flex-col gap-2 rounded-md border border-border p-3">
                {editing === r.address ? (
                  <LabelForm
                    onSave={(l) => {
                      saveAddress(owner, r.address, l);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => onSelect(r.address)} className="flex min-w-0 flex-col items-start text-left">
                      <span className="font-mono text-sm">
                        {shortAddress(r.address)}
                        {isCurrent(r.address) && <span className="ml-2 font-sans text-xs text-destination-text">Selected</span>}
                      </span>
                      <span className="text-xs text-ink-muted">
                        Sent {r.count} {r.count === 1 ? "time" : "times"}, last {new Date(r.lastUsedAt).toLocaleDateString([], { day: "numeric", month: "short" })}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-3">
                      <button type="button" onClick={() => setEditing(r.address)} className={linkBtn}>
                        Save
                      </button>
                      <button type="button" onClick={() => removeRecent(owner, r.address)} className="text-[13px] text-ink-muted hover:text-danger" aria-label={`Remove ${r.address} from recents`}>
                        Remove
                      </button>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
