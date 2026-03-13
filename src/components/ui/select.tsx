"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon } from "lucide-react"

// Context for sharing state between Select sub-components
interface SelectContextType {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  registerLabel: (value: string, label: string) => void
  labels: Record<string, string>
}
const SelectContext = React.createContext<SelectContextType>({
  value: "",
  onValueChange: () => {},
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
  registerLabel: () => {},
  labels: {},
})

// Root
interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children?: React.ReactNode
}
function Select({ value, defaultValue = "", onValueChange, children }: SelectProps) {
  const [internal, setInternal] = React.useState(defaultValue)
  const [open, setOpen] = React.useState(false)
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const controlled = value !== undefined
  const current = controlled ? value : internal

  const handleChange = (v: string) => {
    if (!controlled) setInternal(v)
    onValueChange?.(v)
    setOpen(false)
  }

  const registerLabel = React.useCallback((v: string, label: string) => {
    setLabels(prev => prev[v] === label ? prev : { ...prev, [v]: label })
  }, [])

  // Close on outside click or Escape key
  React.useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (!triggerRef.current?.closest('[data-slot="select-root"]')?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  return (
    <SelectContext.Provider value={{ value: current, onValueChange: handleChange, open, setOpen, triggerRef, registerLabel, labels }}>
      <div data-slot="select-root" className="relative inline-block">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

// Trigger
function SelectTrigger({ className, size = "default", children, ...props }: React.ComponentProps<"button"> & { size?: "sm" | "default" }) {
  const { open, setOpen, triggerRef } = React.useContext(SelectContext)
  return (
    <button
      ref={triggerRef}
      type="button"
      data-slot="select-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pl-2.5 pr-2 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        size === "default" ? "h-8" : "h-7",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
    </button>
  )
}

// Value display
function SelectValue({ placeholder, className }: { placeholder?: string; className?: string }) {
  const { value, labels } = React.useContext(SelectContext)
  const display = value ? (labels[value] ?? value) : null
  return (
    <span data-slot="select-value" className={cn("flex flex-1 text-left", !display && "text-muted-foreground", className)}>
      {display ?? placeholder ?? ""}
    </span>
  )
}

// Dropdown content
function SelectContent({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { open } = React.useContext(SelectContext)
  if (!open) return null
  return (
    <div
      data-slot="select-content"
      role="listbox"
      className={cn(
        "absolute left-0 top-full z-50 mt-1 min-w-full max-h-60 overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className
      )}
    >
      <div className="p-1">{children}</div>
    </div>
  )
}

// Item
function SelectItem({ value, children, className, ...props }: React.ComponentProps<"div"> & { value: string }) {
  const ctx = React.useContext(SelectContext)
  const isSelected = ctx.value === value

  // Register label for display in SelectValue
  React.useEffect(() => {
    const label = typeof children === "string" ? children : ""
    if (label) ctx.registerLabel(value, label)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, children])

  return (
    <div
      data-slot="select-item"
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      onClick={() => ctx.onValueChange(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          ctx.onValueChange(value)
        }
      }}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pl-2 pr-8 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      {isSelected && (
        <span className="absolute right-2 flex size-4 items-center justify-center">
          <CheckIcon className="size-3" />
        </span>
      )}
    </div>
  )
}

// Group
function SelectGroup({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="select-group" className={cn("scroll-my-1 p-1", className)} {...props}>
      {children}
    </div>
  )
}

// Label
function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="select-label" className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)} {...props} />
  )
}

// Separator
function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="select-separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  )
}

function SelectScrollUpButton(_props: { className?: string }) {
  return null // not needed for simple dropdown
}

function SelectScrollDownButton(_props: { className?: string }) {
  return null // not needed for simple dropdown
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
