import { useTheme } from '../hooks/useTheme'

interface ThemeToggleProps {
  className?: string
  iconOnly?: boolean
}

export function ThemeToggle({ className = '', iconOnly = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const iconSize = iconOnly ? 18 : 14
  const baseClassName = iconOnly
    ? 'w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-safety-orange/50'
    : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-safety-orange/50'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`${baseClassName} ${className}`.trim()}
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === 'dark'}
      title={`Switch to ${nextTheme} mode`}
    >
      {theme === 'dark' ? (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 1 0 9 9 9 9 0 1 1-9-9" />
        </svg>
      )}
      {!iconOnly && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
