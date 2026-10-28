'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Info,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

export type DialogVariant = 'primary' | 'danger' | 'warning' | 'info' | 'success';

interface DialogOptions {
  type: 'alert' | 'confirm' | 'prompt';
  title?: string;
  message: string;
  variant?: DialogVariant;
  confirmText?: string;
  cancelText?: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: any) => void;
}

// Global event bus for dialogs
type DialogListener = (dialog: DialogOptions | null) => void;
let activeListener: DialogListener | null = null;

export const modalDialog = {
  alert: (message: string, title = 'Notification', variant: DialogVariant = 'info'): Promise<void> => {
    return new Promise((resolve) => {
      if (activeListener) {
        activeListener({
          type: 'alert',
          title,
          message,
          variant,
          confirmText: 'OK',
          resolve,
        });
      } else {
        // Fallback if component not mounted yet
        console.warn('GlobalModalContainer not mounted. Message:', message);
        resolve();
      }
    });
  },

  confirm: (
    message: string,
    title = 'Confirm Action',
    confirmTextOrVariant: string | DialogVariant = 'Confirm',
    variantOrText: DialogVariant | string = 'primary'
  ): Promise<boolean> => {
    let confirmText = 'Confirm';
    let variant: DialogVariant = 'primary';
    const variants: DialogVariant[] = ['primary', 'danger', 'warning', 'info', 'success'];

    if (variants.includes(confirmTextOrVariant as DialogVariant)) {
      variant = confirmTextOrVariant as DialogVariant;
      if (typeof variantOrText === 'string') confirmText = variantOrText;
    } else {
      confirmText = (confirmTextOrVariant as string) || 'Confirm';
      if (variants.includes(variantOrText as DialogVariant)) {
        variant = variantOrText as DialogVariant;
      }
    }

    return new Promise((resolve) => {
      if (activeListener) {
        activeListener({
          type: 'confirm',
          title,
          message,
          variant,
          confirmText,
          cancelText: 'Cancel',
          resolve,
        });
      } else {
        console.warn('GlobalModalContainer not mounted.');
        resolve(false);
      }
    });
  },

  prompt: (
    message: string,
    defaultValue = '',
    title = 'Input Required',
    placeholder = ''
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      if (activeListener) {
        activeListener({
          type: 'prompt',
          title,
          message,
          defaultValue,
          placeholder,
          confirmText: 'Save',
          cancelText: 'Cancel',
          resolve,
        });
      } else {
        console.warn('GlobalModalContainer not mounted.');
        resolve(null);
      }
    });
  },
};

export const GlobalModalContainer: React.FC = () => {
  const [currentDialog, setCurrentDialog] = useState<DialogOptions | null>(null);
  const [inputValue, setInputValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    activeListener = (dialog) => {
      setCurrentDialog(dialog);
      if (dialog && dialog.type === 'prompt') {
        setInputValue(dialog.defaultValue || '');
      }
    };
    return () => {
      activeListener = null;
    };
  }, []);

  useEffect(() => {
    if (currentDialog && currentDialog.type === 'prompt') {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [currentDialog]);

  if (!currentDialog) return null;

  const handleConfirm = () => {
    const dialog = currentDialog;
    setCurrentDialog(null);
    if (dialog.type === 'prompt') {
      dialog.resolve(inputValue);
    } else if (dialog.type === 'confirm') {
      dialog.resolve(true);
    } else {
      dialog.resolve(undefined);
    }
  };

  const handleCancel = () => {
    const dialog = currentDialog;
    setCurrentDialog(null);
    if (dialog.type === 'prompt') {
      dialog.resolve(null);
    } else if (dialog.type === 'confirm') {
      dialog.resolve(false);
    } else {
      dialog.resolve(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && currentDialog.type !== 'alert') {
      handleConfirm();
    }
  };

  const getIcon = () => {
    const variant = currentDialog.variant || 'info';
    switch (variant) {
      case 'danger':
        return <AlertCircle className="w-5 h-5 text-rose-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'primary':
        return <HelpCircle className="w-5 h-5 text-indigo-400" />;
      case 'info':
      default:
        return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const getConfirmBtnClasses = () => {
    const variant = currentDialog.variant || 'primary';
    switch (variant) {
      case 'danger':
        return 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30';
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30';
      case 'success':
        return 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30';
      case 'primary':
      case 'info':
      default:
        return 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={handleCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-md bg-[#0d121f] border border-slate-700/80 rounded-2xl p-5 shadow-2xl shadow-black/80 space-y-4 animate-in zoom-in-95 duration-150 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shrink-0">
              {getIcon()}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                {currentDialog.title || (currentDialog.type === 'confirm' ? 'Confirm' : 'Notice')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                {currentDialog.message}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Prompt Input Field */}
        {currentDialog.type === 'prompt' && (
          <div className="pt-1">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={currentDialog.placeholder || 'Enter value...'}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all font-sans"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
            />
          </div>
        )}

        {/* Footer Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
          {(currentDialog.type === 'confirm' || currentDialog.type === 'prompt') && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-all"
            >
              {currentDialog.cancelText || 'Cancel'}
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all ${getConfirmBtnClasses()}`}
          >
            {currentDialog.confirmText || (currentDialog.type === 'alert' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
