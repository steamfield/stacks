import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

// Native-button variant of the shadcn/ui pattern; no polymorphic slot dependency.
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-stone-900 text-white hover:bg-stone-700",
        outline: "border border-stone-400 bg-white hover:bg-stone-100",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof button>) {
  return <button type={type} className={button({ variant, className })} {...props} />;
}
