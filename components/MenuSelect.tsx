'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { registerModalLayer } from '@/lib/modal-stack';

export interface MenuSelectOption {
  value: string;
  label: string;
}

export interface MenuSelectGroup {
  label?: string;
  options: MenuSelectOption[];
}

interface MenuSelectProps {
  ariaLabel: string;
  value: string;
  groups: MenuSelectGroup[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  // Composer fields sit at the bottom edge of the screen — their menus open up.
  openUp?: boolean;
  className?: string;
  menuClassName?: string;
}

const triggerBaseClass =
  'flex h-32 w-full cursor-pointer items-center justify-between gap-4 bg-theme-bg px-8 font-mono text-body-14 text-theme-fg outline-none ring-1 ring-theme-fg/30 focus-visible:ring-theme-fg disabled:cursor-not-allowed disabled:opacity-50';

const menuItemClass =
  'flex w-full cursor-pointer items-center gap-8 rounded-2 px-8 py-4 text-left font-mono text-body-14 outline-none hover:bg-theme-fg/10 focus-visible:bg-theme-fg/10';

// The one "choice" control of the design language: a chevron trigger opening a
// menu of menuitemradio items — native <select> is banned. The ✓ is always
// rendered and toggled with `invisible` so the list never shifts layout.
// Keyboard model: ArrowUp/Down wrap, Home/End jump, Tab + Esc close (Esc via
// the shared modal stack so layering order stays correct), focus returns to
// the trigger on any dismissal.
export default function MenuSelect({
  ariaLabel,
  value,
  groups,
  onSelect,
  disabled = false,
  openUp = false,
  className = '',
  menuClassName = '',
}: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({});
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      // Flip upward when the trigger is near the viewport bottom and more
      // room exists above (downward menus in the settings window can land
      // flush against the screen edge).
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = openUp || (spaceBelow < 296 && rect.top > spaceBelow);
      // Menu width tracks the trigger width (spec: the menu IS the trigger,
      // opened). Clamping left against that exact width keeps the menu
      // horizontally anchored to the trigger on narrow viewports.
      const width = Math.min(rect.width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      // Cap the menu height at the room actually available so upward menus on
      // short viewports can't render their checked item off-screen.
      const maxHeight = Math.max(120, Math.min(280, flipUp ? rect.top - 12 : window.innerHeight - rect.bottom - 12));
      setMenuPos(flipUp
        ? { left, bottom: window.innerHeight - rect.top + 4, width, maxHeight }
        : { left, top: rect.bottom + 4, width, maxHeight });
    }
    setOpen(true);
  }, [openUp]);

  const flatOptions = groups.flatMap((group) => group.options);
  const selected = flatOptions.find((option) => option.value === value);

  const close = useCallback((refocusTrigger: boolean) => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const choose = useCallback((next: string) => {
    onSelectRef.current(next);
    close(true);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const unregister = registerModalLayer(menuId, () => close(true), menuRef.current);
    // Focus lands on the checked item, else the first item.
    const menu = menuRef.current;
    const initial = menu?.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-checked="true"], [role="menuitemcheckbox"][aria-checked="true"]',
    ) ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)');
    initial?.focus({ preventScroll: true });
    // A checked item below the fold (e.g. 4K in the size list) is focused
    // invisibly otherwise — bring it into view.
    initial?.scrollIntoView({ block: 'nearest' });
    const onOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The menu is portaled to document.body — it lives outside rootRef.
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      // Consume the gesture like a native menu would: the same pointerdown +
      // pointerup on a modal backdrop must not also dismiss the dialog below.
      event.preventDefault();
      event.stopPropagation();
      // Refocus the trigger: the pointerdown is consumed (never lands), and
      // the focused menu item unmounts — without this focus falls to <body>.
      close(true);
    };
    // Any ancestor scroll (chat, settings panel, composer strip) or viewport
    // resize detaches the fixed menu from its trigger — close instead of
    // leaving it floating. Refocus the trigger for the same reason.
    const onAncestorScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) close(true);
    };
    const onResize = () => close(true);
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    // Defer scroll subscription: a scroll event already in flight when the
    // menu mounts (momentum flick, programmatic scroll-into-view) would
    // otherwise close it instantly.
    const subscribeScroll = setTimeout(() => document.addEventListener('scroll', onAncestorScroll, true), 50);
    window.addEventListener('resize', onResize);
    return () => {
      unregister();
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      clearTimeout(subscribeScroll);
      document.removeEventListener('scroll', onAncestorScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close, menuId]);

  // A trigger that becomes disabled while open (e.g. the model gate
  // re-locks) must not leave its menu hanging — render-phase adjustment.
  if (disabled && open) setOpen(false);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [],
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Tab') {
      // Tab dismisses the menu and keeps focus on the trigger.
      event.preventDefault();
      close(true);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={triggerBaseClass}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selected ? selected.label : value}
        </span>
        <svg aria-hidden viewBox="0 0 10 10" className="size-8 shrink-0 text-theme-muted">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onMenuKeyDown}
          style={menuPos}
          className={`scroll-fade-y fixed z-[9998] flex max-h-280 flex-col gap-1 overflow-y-auto rounded-4 bg-theme-bg p-2 ring-1 ring-theme-fg/30 [scrollbar-width:none] ${menuClassName}`}
        >
          {groups.map((group, groupIndex) => (
            <React.Fragment key={group.label ?? groupIndex}>
              {groupIndex > 0 && <div role="separator" className="mx-8 my-1 border-t border-theme-fg/30" />}
              {group.label && (
                <div role="presentation" className="px-8 pb-1 pt-3 text-body-10 uppercase text-theme-muted">
                  {group.label}
                </div>
              )}
              {group.options.map((option) => {
                const checked = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    tabIndex={-1}
                    onClick={() => choose(option.value)}
                    className={menuItemClass}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span aria-hidden className={`shrink-0 text-theme-dim ${checked ? '' : 'invisible'}`}>✓</span>
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
