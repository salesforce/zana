export const MOBILE_INSTALL_PROMPT = `Install or update the Zana mobile app on my connected physical phone and connect it to this running Zana desktop app. Carry out the installation, not just a list of instructions.

Work from this computer. Inspect the connected physical devices and identify the intended phone; distinguish USB devices, wireless devices, and simulators. If the target is ambiguous, ask me which phone before installing.

Find the existing Zana source checkout and read docs/mobile-app.md and apps/mobile/README.md. If it is unavailable, locate the official Zana source and installation instructions from https://github.com/salesforce/zana. Do not assume the current project is the Zana repository or overwrite unrelated work.

Check the required tools and prepare a standalone build with bundled JavaScript. For iPhone, use macOS, Xcode, and the existing Apple signing account; verify the provisioning profile includes this exact device. For Android, use the Android SDK and target the exact device with adb. Preserve existing app data when updating.

Guide me only through steps that require my interaction: unlocking the phone, trusting this computer, Apple sign-in, enabling iPhone Developer Mode (Settings → Privacy & Security → Developer Mode, restart, then Turn On), or enabling Android USB debugging and accepting its authorization prompt. Never ask me to paste passwords or signing credentials into chat. Continue the build and installation once the phone is ready.

Install and launch Zana, then use Settings → Phone in the desktop app to enable phone access and generate a fresh pairing QR or deep link. Keep both devices on the same trusted network and use the authenticated mobile gateway. Open the pairing form on the phone when possible and guide me through Connect and the local-network permission. Do not publish to an app store, expose the desktop server publicly, or restart the desktop app and interrupt running agents without asking.

Verify the installed app launches and the phone connects to this desktop. Tell me what was installed, which phone received it, and any remaining action I need to take.`;
