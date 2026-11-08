# Motion

A certificate does not move. Motion in CoveredMarket is rare, short and means something.

- **Hover and focus**: 120ms linear colour change. No lift, no scale.
- **The stamp lands**: when a status changes on screen (an offer sold, a contract kept), the `Stamp` appears once in 180ms, from scale 1.15 and rotation -4° to its resting 1 and -1.5°, ease-out. The only "celebration" in the product.
- **The Countdown arc** moves only on the contract's own page, updating once a second, with no easing.
- **The certificate reveal** on the contract page: the braids draw in over 400ms (`stroke-dashoffset`), then the text appears. Once per page load.
- **Page and panel changes**: no slide-ins, no fades over 120ms. Content replaces content.
- **Charts** draw their line once, 300ms, left to right.

Never: looping animations, pulsing dots, confetti, number counters that tick up, skeleton shimmer (use a dashed `rule` outline for loading), parallax, spinners inside buttons.

Respect `prefers-reduced-motion`: every animation above collapses to its end state.
