import type { ComponentType, ReactNode } from "react";

/**
 * The link the kit renders. A host passes its router's link (Next.js `Link`, say) so navigation
 * stays client-side; the default is a plain anchor.
 */
export type LinkLike = ComponentType<{ href: string; className?: string; children?: ReactNode }>;

export const PlainLink: LinkLike = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);
