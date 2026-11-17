# Support policy

[עברית](support-policy.he.md)

What Lumen runs on, what we test, and how long each version gets security fixes. The same facts are kept as data in [`support-matrix.json`](support-matrix.json), and `npm run support:check` holds the code to them (plan W13.T2).

## Where Lumen runs

| Runtime | Supported |
|---|---|
| Chrome and Chromium browsers | the two latest stable versions |
| Microsoft Edge | the two latest stable versions |
| Firefox | the two latest stable versions, and the current ESR (140) |
| Safari (macOS, iOS, iPadOS) | 26 and later |
| Desktop app on macOS | macOS 14 Sonoma, with Safari 26 installed (the app uses the system WebKit) |
| Desktop app on Windows | Windows 10 (22H2) and Windows 11, with WebView2 Evergreen |
| Desktop app on Linux | x86-64 or ARM64 with WebKitGTK 2.48 or later (webkit2gtk-4.1) |
| iPhone and iPad app | iOS and iPadOS 18 and later |
| Android app | Android 10 (API 29) and later, with an up-to-date Android System WebView |

"Supported" means: we test on it before a release, a bug that only happens there is a bug we fix, and the app tells you when you are outside it. Lumen may still open on older browsers and systems, but nothing there is promised.

- **Android:** the app installs from Android 7 (API 24), but Android 7 to 9 no longer get Android System WebView updates, so they are outside support.
- **Desktop app:** it uses the system's web engine (WebKit on macOS and Linux, WebView2 on Windows), so its floor is the engine's, not only the OS version.

## Your browser is outside support

When Lumen starts in a browser older than this policy, it shows a notice once per version, with a link here. It does not stop you: your notes stay on your device, and you can export them at any time (File → Export). Updating the browser removes the notice.

## How the code keeps to it

The oldest engines we support set a floor: **Chrome and Edge 140, Firefox 140 (ESR), Safari/WebKit 18.0** (the iPhone and iPad app runs in the system WebKit, so iOS 18 sets the WebKit floor; Safari 26 is the browser floor). `npm run support:check`:

1. lists 40 web APIs with the first version of each engine that has them (from MDN browser-compat-data and the [web-features](https://web-platform-dx.github.io/web-features/) Baseline data);
2. fails when the code uses one that an engine at the floor lacks, unless that file feature-detects it (an optional call, `typeof`, `"name" in`, or a marked guard);
3. checks that `browserslist` in package.json, these two pages and the iOS deployment target say the same thing.

The floor and the table are reviewed at every minor release.

## Security fixes

| Line | Status | Security fixes |
|---|---|---|
| 0.1.x | current | While it is the newest release line, and for critical and high severity for 90 days after the next minor line ships. |

Lumen gets security updates for at least five years from its first public release, and never ending before 31 December 2031 (CRA Art. 13(8)). They ship in the newest release line, which every user can move to free of charge (Art. 13(10)); each security update stays downloadable for at least ten years (Art. 13(9)).

How to report a vulnerability, and what happens then: [SECURITY.md](../SECURITY.md).

## Changes to this policy

A change to the floor or to a minimum is announced in the release notes of the version before it takes effect, so nobody is moved outside support without warning.
