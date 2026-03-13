"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SwitchProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
  size?: "sm" | "default"
}

function Switch({ checked = false, onCheckedChange, disabled, className, size = "default" }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      className={cn(
        "peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        size === "default" ? "h-5 w-9" : "h-4 w-7",
        checked ? "bg-primary" : "bg-input",
        className
      )}
    >
      <span
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform",
          size === "default" ? "size-4" : "size-3",
          checked
            ? size === "default" ? "translate-x-4" : "translate-x-3"
            : "translate-x-0"
        )}
      />
    </button>
  )
}

export { Switch }
