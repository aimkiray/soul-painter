'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

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

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center min-h-screen bg-black font-mono text-[#CCC] p-4">
          <div className="bg-black border-2 border-[#aa0000] p-4 max-w-md w-full">
            <div className="text-[#ff5555] font-bold text-sm mb-2">
              运行时错误
            </div>
            <pre className="text-xs text-[#ff5555] whitespace-pre-wrap break-all">
              {this.state.error?.message || '未知错误'}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 btn-retro px-3 py-1 text-xs w-full"
            >
              [ 重试 ]
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
