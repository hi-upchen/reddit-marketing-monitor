"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

// Context to share onOpenChange down to DialogClose without prop-drilling
interface DialogContextType {
  onOpenChange?: (open: boolean) => void
}
const DialogContext = React.createContext<DialogContextType>({})

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => { setMounted(true) }, [])

  // Close on Escape key
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange?.(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  if (!mounted || !open) return null

  return (
    <DialogContext.Provider value={{ onOpenChange }}>
      {createPortal(
        <div data-slot="dialog">
          {/* Backdrop */}
          <div
            data-slot="dialog-overlay"
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
            onClick={() => onOpenChange?.(false)}
          />
          {children}
        </div>,
        document.body
      )}
    </DialogContext.Provider>
  )
}

function DialogTrigger({ children, onClick, ...props }: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return React.cloneElement(children as React.ReactElement<any>, { onClick, ...props })
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-content"
      role="dialog"
      aria-modal="true"
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-background p-4 text-sm shadow-lg ring-1 ring-foreground/10 sm:max-w-sm",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
      )}
    </div>
  )
}

function DialogClose({ className, onClick, children, ...props }: React.HTMLAttributes<HTMLButtonElement>) {
  // Read onOpenChange from context so close button works without explicit wiring
  const { onOpenChange } = React.useContext(DialogContext)
  return (
    <button
      data-slot="dialog-close"
      type="button"
      className={cn(className)}
      onClick={(e) => {
        onOpenChange?.(false)
        onClick?.(e as React.MouseEvent<HTMLButtonElement>)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, children, ...props }: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function DialogOverlay({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/20 backdrop-blur-sm", className)}
      {...props}
    />
  )
}

function DialogPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
