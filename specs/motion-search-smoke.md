# Search motion regression check

The busy search indicator previously translated a pseudo-element beyond the form,
painting over the navigation rail. Its gradient now travels inside a fixed strip
inset from the form edges. Keep the form overflow visible for its dropdown menus.

1. Open Search in both light and dark themes, at the minimum window size and maximized.
2. Start a search and watch at least two complete scan cycles. The animated line must
   stay inside the search bar and never cross the navigation rail or results panel.
3. Cancel the search. The scan must disappear and the input must be usable again.
4. Open the platform picker and Filters. Their menus must extend beyond the form
   without clipping, and their options must remain clickable.
5. Disable Motion graphics in Appearance, then repeat with the Windows reduced-motion
   preference enabled. The scan must be absent in either case; Cancel stays available.
