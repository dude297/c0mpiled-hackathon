# Testing DayBridge on your iPhone

This guide shows how to open the DayBridge phone app on an iPhone and try it out. It takes about 10 minutes.

The app is in the Expo team **sparsh9gs-team** as project `@sparsh9gs-team/daybridge`.

## What you need
- An iPhone with **Expo Go** from the App Store (SDK **57**).
- A free Expo account. You get one when you accept the team invite.

## Option A: open the team link (fastest, no laptop needed)
1. Open the **Expo team invite email** and tap **Accept**. If you don't have an Expo account yet, make one when it asks.
2. Install **Expo Go** from the App Store.
3. Open Expo Go and **sign in** with the same account (tap the person icon at the top right).
4. On the iPhone, open this link in **Safari**:
   `exp://u.expo.dev/2a05e56a-99a8-40b9-bec1-3421b250593d?channel-name=main`
5. Tap **Open in Expo Go**. The first load takes 30 to 60 seconds.

This link opens the latest version published to the `main` channel, so Sparsh's laptop doesn't need to be on. If it says no update was found, ask Sparsh to publish one.

## Option B: run it yourself (needs a Mac with Node 22+ and git)
```bash
git clone https://github.com/dude297/c0mpiled-hackathon.git
cd c0mpiled-hackathon && git checkout mobile/expo
cd mobile && npm install
npx expo login          # your own Expo account
npx expo start --tunnel
```
Point the iPhone Camera at the QR code. It opens in Expo Go, which needs to be signed in to the same account.
- `--lan` works without a login, but only when the phone and Mac are on the same Wi-Fi and that Wi-Fi lets devices see each other. Venue Wi-Fi often blocks this.

## What to test (about 5 minutes)
1. On the first screen, pick **Demo: Margaret** or **Demo: Harold**, or enter your own name.
2. Pick a mode:
   - **Swipe cards**: swipe right to like an interest and left to pass. You should feel a light tap.
   - **Easier view (big tiles)**: tap large tiles instead of swiping.
   - **Hands-free (eye tracker)**: tap Start and allow the camera. Hold still for 2 seconds, then look or tilt your head toward ❤️ to answer. If left and right feel reversed, tap **Swap sides**. The camera stays on the phone and nothing is recorded.
3. Answer the questions that follow, then check the **"Here's what we heard"** screen. Tap **Change** on one answer and make sure the other answers stay the same.
4. Tap **See my matches**. Tap the heart to add or remove a match. Tap **"Not a match — here's why"** to read the reason.
5. Open the **My week** tab and check that your added items are there.

## Report back
Send Sparsh one message that lists anything that felt wrong or confusing. Include your phone model, iOS version, and whether you used Option A or B.

## Known limits
- Haptics, swiping, and hands-free mode only work in Expo Go on a real phone. They don't work in a web browser.
- Rides and invites on "Get me there" are simulated, and the app labels them that way.

## Accessibility check before publishing an update

These are manual acceptance checks, not completed device-test results. Use a small phone
viewport (375 × 667 points), then repeat with the largest system text size. A local
TypeScript check or Expo export does not validate VoiceOver, TalkBack, or camera behavior.

1. On the name screen, read each sample-person button and answer-mode option with VoiceOver
   or TalkBack. The selected mode and disabled controls should be announced correctly.
   Start without entering a name, then return to confirm the optional name still works.
2. On an interest card, open the screen reader's actions menu. Its Yes and No actions must
   answer that interest exactly once, just like the visible buttons. Back must undo the
   same answer. Decorative cards behind the current one and LIKE/NOPE stamps must not be read.
3. At large text sizes, scroll within the interest card to read its complete name and
   instructions. Check that a vertical scroll does not answer the card and that Back,
   No, and Yes remain reachable. In Easier view, each full tile label must remain readable.
4. In a required question, hear the checked state of each answer and the disabled state
   of Continue until an answer is selected. At review, check every Change button remains
   visible, named for its answer, and reachable without overlapping enlarged text.
5. In Matches, hear the added/not-added state of each "Add to my week" switch. Expand and
   collapse the source explanation and blocked-activity list, checking the expanded state.
   Check all three tab labels at large text sizes; labels must wrap rather than truncate.
6. Hands-free is optional: only tap **Turn on camera** when you want to test it. On iOS,
   status changes and answers should be spoken once; Android uses live status regions.
   Calibration percentages must not be announced every frame. Stop should announce that
   the camera is off. Error and privacy text must be fully readable by scrolling, and the
   manual No/Yes buttons must work even if camera permission is denied.

All buttons and answer tiles should provide at least a 56 × 56 point touch area. Native
device checks are still required for font rendering, touch areas, and announcements.
