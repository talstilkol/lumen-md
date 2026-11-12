---
title: Photo metadata
description: Photos you paste or drop into a note lose their GPS position, time, device and text metadata before they are stored.
---

A photo from a phone or a camera usually says **where** it was taken (GPS),
**when**, on **which device** (make, model, sometimes a serial number) and
sometimes **who** took it. If you share the note, export it or sync it,
that information goes with the photo.

Lumen removes it the moment you paste or drop a JPEG, PNG or WebP into a
note, before the image is stored in the vault or put inline:

- **Removed:** EXIF (GPS, date and time, camera, owner), XMP, IPTC,
  comments, and PNG text and time chunks.
- **Kept:** the pixels, exactly as they were (nothing is re-compressed), the
  colour profile, and the photo's orientation, so a portrait photo still
  stands upright.

GIF, SVG, HEIC and AVIF images are stored as they are. Photos already in
the vault are not changed.

To keep the metadata (for example, for your own photo archive), set
`localStorage["lumen.images.keepMetadata"] = "1"` in the browser's developer
tools. A switch in Settings is planned.
