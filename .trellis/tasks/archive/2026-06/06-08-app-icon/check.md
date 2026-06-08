# App Icon Landing Check

## Changed

* Replaced Tauri desktop and Windows icon resources under `src-tauri/icons/` using the selected orange handwritten `Π` source image.
* Generated via `npx tauri icon` and removed extra untracked mobile/64px outputs that are not used by current `tauri.conf.json`.
* Updated the in-app topbar brand mark from the old inline SVG to a white `Π` text mark with existing orange brand tile styling.

## Verification

* Confirmed source image is square: 1254x1254.
* Confirmed generated PNG dimensions:
  * `32x32.png` -> 32x32
  * `128x128.png` -> 128x128
  * `128x128@2x.png` -> 256x256
  * `icon.png` -> 512x512
  * Windows Store/Square logos match expected square dimensions.
* Confirmed `icon.ico` and `icon.icns` exist.
* Visually inspected `src-tauri/icons/icon.png`.
* Ran `npm run build` successfully after the GUI brand mark update.

## Notes

No business logic changed.
