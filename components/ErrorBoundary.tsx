'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  // Nested boundaries (a panel inside the desktop) render a compact crash
  // pane instead of bluescreening the whole app.
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Crash = full AMIBIOS boot homage: blue screen, chrome bars, cyan device
// lines, CRT scanlines, blinking block cursor. Any key or click reboots —
// the boundary resets and remounts its children.
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  componentDidMount() {
    // A child can throw during the boundary's first render — wire the
    // keydown reboot even when there was no false→true transition.
    if (this.state.hasError) window.addEventListener('keydown', this.reboot);
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.state.hasError && !prevState.hasError) {
      window.addEventListener('keydown', this.reboot);
    } else if (!this.state.hasError && prevState.hasError) {
      window.removeEventListener('keydown', this.reboot);
    }
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.reboot);
  }

  reboot = (event?: KeyboardEvent) => {
    // Modifier-only presses (Shift, Cmd…) are not "a key" — ignoring them
    // keeps the error text selectable/copyable before the reboot.
    if (event && ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.compact) {
        return (
          <div role="alert" className="m-8 flex flex-col gap-8 p-12 font-mono text-body-14 text-theme-fg ring-1 ring-error">
            <span className="uppercase">[ 模块崩溃 ]</span>
            <span className="line-clamp-3 break-all text-theme-dim">{this.state.error?.message || '未知错误'}</span>
            <button type="button" onClick={() => this.reboot()} className="self-start bg-theme-fg px-8 py-2 text-theme-bg">
              重试
            </button>
          </div>
        );
      }
      return this.props.fallback || (
        <div
          role="alert"
          className="fixed inset-0 z-[10000] flex flex-col bg-[#0000a8] font-mono text-body-14 leading-[1.25] text-[#c6c6c6] selection:bg-[#d4d4d4] selection:text-[#0000a8]"
        >
          {/* CRT scanlines — the one sanctioned gradient overlay */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-6 motion-reduce:hidden"
            style={{ backgroundImage: 'repeating-linear-gradient(to bottom,#fff 0,#fff 1px,transparent 1px,transparent 3px)' }}
          />
          <div className="bg-[#a8a8a8] px-8 py-2 text-center text-[#000080]">
            AMIBIOS(C)2026 American Megatrends, Inc.
          </div>
          <div className="flex-1 overflow-hidden whitespace-pre-wrap px-8 py-12">
            <span className="text-white">{'Soul Painter BIOS Revision 1001\n'}</span>
            <span className="text-white">{'CPU : Soul CPU at 266MHz\n'}</span>
            <span className="text-white">{'Memory Test : 65536K OK\n\n'}</span>
            <span className="text-[#54fcfc]">{'Detecting primary master  ... REFS.IMG\n'}</span>
            <span className="text-[#54fcfc]">{'Detecting primary slave   ... PROMPT.SYS\n\n'}</span>
            <span className="text-white">{'BOOT FAILURE\n'}</span>
            <span className="line-clamp-3 break-all">{`${this.state.error?.message || '未知错误'}\n`}</span>
          </div>
          <div className="flex items-center justify-between bg-[#a8a8a8] px-8 py-2 text-[#000080]">
            <span>Press any key to reboot</span>
            <span className="flex items-center gap-12">
              <button type="button" onClick={() => this.reboot()} className="cursor-pointer bg-[#000080] px-8 py-1 text-[#d4d4d4]">
                [REBOOT]
              </button>
              <span aria-hidden className="inline-block h-14 w-8 animate-blink bg-[#d4d4d4] align-middle motion-reduce:animate-none" />
            </span>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
