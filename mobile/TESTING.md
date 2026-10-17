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
