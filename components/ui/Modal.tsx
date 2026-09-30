"use client";

import React, { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * A real modal dialog.
 *
 * The previous version rendered a literal "?" as the close button, had no
 * `role="dialog"`, no Escape handler, no focus management, no scroll lock, and
 * no "use client" — it only worked because both of its importers happened to be
 * client components, so it broke the moment a Server Component rendered it.
 *
 * Implemented natively on `<dialog>` rather than a div, because the browser then
 * supplies the top layer, the backdrop, the focus trap and inertness of the page
 * behind it. `showModal()` throws if the element is already open, hence the
 * guard, and `cancel` fires on Escape, which is how the native close request
 * becomes an `onClose` call.
 */
export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The element that had focus before the dialog opened, so it can be given
  // back on close. Without this, focus lands on <body> and a keyboard user has
  // to tab the whole page again.
  const restoreTo = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (isOpen) {
      restoreTo.current = document.activeElement as HTMLElement | null;
      if (!el.open) el.showModal();
      return;
    }

    if (el.open) el.close();
  }, [isOpen]);

  // Escape and the native close button both fire `cancel`/`close`. Route them
  // through the same handler so a dismiss always tells the parent, which is what
  // actually resets its `isOpen` state.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onCancel = (e: Event) => {
      e.preventDefault();
      requestClose();
    };
    const onCloseEvent = () => {
      if (isOpen) requestClose();
      restoreTo.current?.focus?.();
    };

    el.addEventListener("cancel", onCancel);
    el.addEventListener("close", onCloseEvent);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("close", onCloseEvent);
    };
  }, [isOpen, requestClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // `m-0` and explicit padding because <dialog> ships a default UA margin
      // and a centred default placement that fights the layout below.
      className="m-auto w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <h3 id={titleId} className="text-lg font-semibold text-sky-400">
          {title}
        </h3>
        <button
          type="button"
          onClick={requestClose}
          aria-label={`Close ${title}`}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
