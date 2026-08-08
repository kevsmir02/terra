import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/(--emph-medium) px-3 py-3 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/(--emph-subtle) disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/(--emph-subtle) md:text-sm dark:aria-invalid:border-destructive/(--emph-medium) dark:aria-invalid:ring-destructive/(--emph-soft)",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
