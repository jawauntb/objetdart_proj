# Local-first trail and guide validation

Status: **pending human and TestFlight evidence**. The implementation and automated checks can prove ordering, access gates, bounded storage, layout intent, and absence of a purge action. They cannot prove comprehension, return value, touch comfort, VoiceOver quality, or physical-device behavior.

## Build under test

Record the TestFlight build number, commit SHA, iOS/iPadOS versions, device model, text-size setting, reduced-motion setting, VoiceOver state, network state, universe seed, and branch id before each session. Do not combine results from different native runtime versions.

The Expo route layer is the sought trail and guide shell. Swift/Metal remains the authoritative simulation. An over-the-air JavaScript update must not be treated as validation of native simulation, haptic, audio, or renderer changes; those require a fresh native build.

## G2 local comprehension protocol

Recruit six first-time participants. Each receives one local universe and no narrated tutorial.

1. Ask the participant to cause a visible change in wave, cell, and solar material.
2. Ask them to open the trail and identify one cause, its consequence, and the scale where it happened.
3. Ask them to use that event’s return anchor and choose a next intervention.
4. Create two local branches from one common ancestor. Ask them to compare parentage, defer switching, switch, return, retire the branch they are not inhabiting, and restore it.
5. Ask them to open the guide directly, then discover a different concept in material and open its post-discovery reveal.
6. Repeat on three separate days without reminders. Keep the device offline for at least one complete return session.

The local G2 gate passes only when at least four of six participants reopen the same universe on three separate days, recognize one consequential change, and use its history to choose a next intervention. Cross-device continuity and the fourteen-day clause remain later evidence after CloudKit work; they are not implied by this local check.

## Accessibility and layout matrix

Run the full flow on a compact iPhone and regular-width iPad in portrait and landscape. Repeat with the largest accessibility text size, reduced motion, sound off, motion permission denied, VoiceOver, and Switch Control.

Verify that long histories remain scrollable, headings do not clip, focus enters the trail or guide heading, each event reads cause before consequence, every return anchor names its destination, and dismissal restores focus to the originating scene. With VoiceOver, confirm that direct accessibility access uses the same canonical plain wording and notation as discovery and direct seeking.

## Retirement and permanent removal

Retirement must always be reversible, require an explicit confirmation, and refuse the currently inhabited branch. Verify the branch remains present with its parentage and events after retirement and returns unchanged after restore.

Permanent removal is intentionally unavailable from playable material, the trail, and the guide. The future system flow must offer an export first, state that local and cloud recovery will end, require a separate explicit confirmation, and only then permit purge. Until that external flow exists and is tested, record purge validation as **not implemented**, never as passed.

## Evidence record

For every participant/session, retain anonymized task outcomes, the selected historical event, their explanation of cause and consequence, the chosen next intervention, branch actions, accessibility settings, failures, and observer notes. A screenshot is supporting evidence, not proof that the interaction or scientific relationship was understood.
