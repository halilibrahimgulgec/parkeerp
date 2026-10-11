import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-red-100 p-6 text-center space-y-4">
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
              <AlertTriangle size={28} />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {this.props.fallbackTitle || 'Sayfa Yüklenirken Bir Hata Oluştu'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Beklenmeyen bir arayüz hatası meydana geldi. Uygulamayı yeniden başlatabilir veya ana sayfaya dönebilirsiniz.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 bg-red-50/70 border border-red-200/60 rounded-xl text-left">
                <span className="text-[10px] uppercase font-bold text-red-700 tracking-wider block mb-1">Hata Detayı:</span>
                <code className="text-xs text-red-900 font-mono break-all line-clamp-3 block">
                  {this.state.error.message}
                </code>
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>Tekrar Dene</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  this.handleReset();
                  window.location.href = window.location.pathname;
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all active:scale-95 cursor-pointer"
              >
                <Home size={14} />
                <span>Ana Sayfaya Dön</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
