import { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

/** Reusable button component with Beans design system variants */
export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'rounded-full font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-[#B8960C] text-white hover:bg-[#a07c0a]',
        variant === 'secondary' && 'bg-white text-[#1A1A1A] border border-gray-200 hover:bg-gray-50',
        variant === 'danger' && 'bg-[#DC2626] text-white hover:bg-red-700',
        variant === 'ghost' && 'bg-transparent text-[#B8960C] hover:bg-yellow-50',
        size === 'sm' && 'px-4 py-2 text-sm',
        size === 'md' && 'px-6 py-3 text-base',
        size === 'lg' && 'px-8 py-4 text-lg',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
