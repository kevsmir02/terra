import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 data-horizontal:h-0 data-horizontal:w-full data-horizontal:border-t data-vertical:w-0 data-vertical:self-stretch data-vertical:border-l",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
