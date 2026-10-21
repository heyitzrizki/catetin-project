import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  // Distinguish between indeterminate progress (null | undefined) and legitimate 0% progress
  const isDeterminate = typeof value === "number";
  const percentage = isDeterminate
    ? Math.min(100, Math.max(0, value))
    : 0;

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={isDeterminate ? percentage : undefined}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-sm bg-secondary",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full bg-primary transition-all duration-300 ease-in-out",
          isDeterminate
            ? "w-full"
            : "w-1/3 animate-progress-indeterminate"
        )}
        style={
          isDeterminate
            ? { transform: `translateX(-${100 - percentage}%)` }
            : undefined
        }
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
