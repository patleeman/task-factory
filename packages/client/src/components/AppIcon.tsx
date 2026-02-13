import type { LucideIcon } from 'lucide-react'

const ICON_SIZE_CLASSES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
} as const

type IconSize = keyof typeof ICON_SIZE_CLASSES

interface AppIconProps {
  icon: LucideIcon
  size?: IconSize
  className?: string
  strokeWidth?: number
}

export function AppIcon({
  icon: Icon,
  size = 'sm',
  className = '',
  strokeWidth = 2,
}: AppIconProps) {
  return (
    <Icon
      aria-hidden="true"
      focusable={false}
      strokeWidth={strokeWidth}
      className={`${ICON_SIZE_CLASSES[size]} ${className}`.trim()}
    />
  )
}
