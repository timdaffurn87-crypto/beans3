import { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  dark?: boolean
}

/** White card with rounded corners and shadow — the base UI block */
export function Card({ dark = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl shadow-sm',
        dark ? 'bg-[#1A1A1A] text-white' : 'bg-white text-[#1A1A1A]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
