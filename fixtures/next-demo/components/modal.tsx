"use client";

import { type ReactNode, useEffect, useRef } from "react";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      data-pathcompiler="dialog.container"
      ref={dialog}
      aria-label={title}
      onCancel={onClose}
    >
      <div className="row">
        <h2>{title}</h2>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          data-pathcompiler="dialog.close"
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
