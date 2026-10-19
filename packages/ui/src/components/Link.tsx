import type { ComponentType, ReactNode } from "react";

/**
 * The link the kit renders. A host passes its router's link (Next.js `Link`, say) so navigation
 * stays client-side; the default is a plain anchor.
 */
export type LinkLike = ComponentType<{
  href: string;
  className?: string;
  children?: ReactNode;
  /** This link leads to what is already open, so a reader is told they are there. */
  "aria-current"?: "page";
}>;

export const PlainLink: LinkLike = ({ href, className, children, ...rest }) => (
  <a href={href} className={className} aria-current={rest["aria-current"]}>
    {children}
  </a>
);
