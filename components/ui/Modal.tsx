import React from "react";
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}
export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      {" "}
      <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-white">
        {" "}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          {" "}
          <h3 className="text-lg font-semibold text-sky-400">{title}</h3>{" "}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {" "}
            ?{" "}
          </button>{" "}
        </div>{" "}
        <div className="mt-4">{children}</div>{" "}
      </div>{" "}
    </div>
  );
}
