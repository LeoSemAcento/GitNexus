import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, ChevronRight, Home, X, Loader2, AlertCircle, Check } from '@/lib/lucide-icons';
import { listDirectories, type DirEntry } from '../services/backend-client';
import { useTranslation } from 'react-i18next';

interface DirectoryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (absolutePath: string) => void;
  initialDir?: string;
}

export const DirectoryPicker = ({ open, onClose, onSelect, initialDir }: DirectoryPickerProps) => {
  const { t } = useTranslation('onboarding');
  const [currentDir, setCurrentDir] = useState(initialDir ?? '/');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchEntries = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDirectories(dir);
      setEntries(result.entries);
      setCurrentDir(dir);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to list directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchEntries(initialDir ?? '/');
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [open, initialDir, fetchEntries]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const segments = currentDir.split('/').filter(Boolean);

  const navigateTo = (dir: string) => {
    fetchEntries(dir);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = '/' + segments.slice(0, index + 1).join('/');
    navigateTo(target);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        data-testid="directory-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('repoAnalyzer.directoryPicker.title')}
        tabIndex={-1}
        className={`relative mx-4 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-2xl transition-all duration-200 outline-none ${isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        style={{ maxHeight: '70vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {t('repoAnalyzer.directoryPicker.title')}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <nav
          aria-label="Directory breadcrumb"
          className="flex items-center gap-1 overflow-x-auto border-b border-border-subtle bg-elevated/50 px-5 py-2"
        >
          <button
            data-testid="directory-picker-home"
            onClick={() => navigateTo('/')}
            aria-label="Root directory"
            className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-3 w-3 text-text-muted/50" aria-hidden="true" />
              <button
                onClick={() => handleBreadcrumbClick(i)}
                aria-current={i === segments.length - 1 ? 'location' : undefined}
                className={`rounded-md px-1.5 py-1 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
                  i === segments.length - 1
                    ? 'font-medium text-text-primary'
                    : 'text-text-muted hover:text-accent'
                }`}
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>

        {/* Directory listing */}
        <div
          data-testid="directory-listing"
          className="min-h-[200px] flex-1 overflow-y-auto px-2 py-2"
        >
          {loading && (
            <div className="flex items-center justify-center py-12" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              <span className="sr-only">Loading directories...</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-2 py-12 text-center" role="alert">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <p className="text-xs text-red-400">{error}</p>
              <button
                onClick={() =>
                  navigateTo(currentDir === '/' ? '/' : currentDir.replace(/\/[^/]+$/, '') || '/')
                }
                className="mt-1 rounded-md px-2 py-1 text-xs text-text-muted underline transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                {t('repoAnalyzer.directoryPicker.goBack')}
              </button>
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-12 text-center">
              <Folder className="h-5 w-5 text-text-muted/50" />
              <p className="text-xs text-text-muted">{t('repoAnalyzer.directoryPicker.empty')}</p>
            </div>
          )}

          {!loading &&
            !error &&
            entries.map((entry) => {
              const target = currentDir === '/' ? `/${entry.name}` : `${currentDir}/${entry.name}`;
              return (
                <button
                  key={entry.name}
                  data-testid={`dir-entry-${entry.name}`}
                  onClick={() => navigateTo(target)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none active:bg-hover/70"
                >
                  <Folder className="h-4 w-4 shrink-0 text-accent/70" />
                  <span className="truncate font-mono text-xs text-text-secondary">
                    {entry.name}
                  </span>
                  <ChevronRight
                    className="ml-auto h-3 w-3 shrink-0 text-text-muted/40"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
        </div>

        {/* Footer — current path + select button */}
        <div className="flex items-center gap-3 border-t border-border-subtle bg-elevated/30 px-5 py-3">
          <code
            data-testid="directory-picker-path"
            className="min-w-0 flex-1 truncate rounded bg-void px-2.5 py-1.5 font-mono text-xs text-text-secondary"
          >
            {currentDir}
          </code>
          <button
            data-testid="directory-picker-select"
            onClick={() => onSelect(currentDir)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none active:bg-accent/80"
          >
            <Check className="h-3.5 w-3.5" />
            {t('repoAnalyzer.directoryPicker.select')}
          </button>
        </div>
      </div>
    </div>
  );
};
