// Gameplay tuning values agreed in docs/DESIGN.md.
export const PLAYER = {
  walkSpeed: 2.4, // m/s
  proneSpeed: 1.8, // 75% of walk
  runSpeed: 6.0, // standing only
  eyeHeightStand: 1.65,
  eyeHeightProne: 0.35,
  runThreshold: 0.95, // joystick deflection at which walking becomes running
} as const;

export const LOOK = {
  mouseSensitivity: 0.0022, // rad per pixel
  touchSensitivity: 0.0045,
  // Portrait view is narrow horizontally, so turning is a little faster than tilting.
  horizontalBoost: 1.3,
  maxPitch: Math.PI / 2 - 0.05,
  verticalFov: 75, // degrees; ≈40° horizontal at 9:16
  // Scoped drag slows as zoom^-0.7 rather than 1/zoom, so a moving deer can still be followed.
  scopedLookExponent: 0.7,
  // While scoped the left stick aims instead of walking (the right thumb is on the fire button).
  stickAimRate: 1.6, // rad/s at full deflection, before zoom scaling
} as const;
