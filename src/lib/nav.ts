export type NavLink = {
  label: string;
  href: string;
};

/** Main customer-facing destinations, shown inline on desktop and in the ribbon menu. */
export const primaryNav: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Menu", href: "/menu" },
  { label: "About", href: "/about" },
  { label: "FAQ & Contact", href: "/contact" },
];
