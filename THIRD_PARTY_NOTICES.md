# Third-Party Notices & Attributions

This repository incorporates or references the following third-party software,
fonts, and dataset segments. Each item remains subject to its original license.

---

## 1. TinyJAMBU-128 AEAD

- **Integrated location in repository:**
  - C/Xtensa implementation: `firmware/main/tinyjambu/` (license preserved at `firmware/main/tinyjambu/LICENSE`)
  - Web TypeScript implementation: `web/src/core/tinyjambu.ts` (NIST LWC Known Answer Test verification in `web/tests/tinyjambu.test.ts` and firmware KAT test in `firmware/tests/test_features.c`)
- **Upstream origin:** TinyJAMBU C/Assembly library (derived from `TinyJAMBU-master`, NIST Lightweight Cryptography finalist)
- **License:** MIT License

```text
Copyright (C) 2022 Southern Storm Software, Pty Ltd.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## 2. GRABMyo v1.1.0 (Derived Embedded Replay Segment)

- **Integrated location in repository:**
  - `firmware/main/replay_data.c` (and attribution history in `firmware/docs/REPLAY_SOURCES.md`)
- **Source:** PhysioNet — Gesture Recognition and Biometrics ElectroMyogram (GRABMyo), version 1.1.0
  - URL: https://physionet.org/content/grabmyo/1.1.0/
  - DOI: https://doi.org/10.13026/89dm-f662
  - Citation: Jiang, N., Pradhan, A., & He, J. (2024). Gesture Recognition and Biometrics ElectroMyogram (GRABMyo), version 1.1.0. PhysioNet. Original dataset paper: Pradhan, A., He, J. & Jiang, N. Multi-day dataset of forearm and wrist electromyogram for hand gesture recognition and biometrics. *Scientific Data* 9, 733 (2022). https://doi.org/10.1038/s41597-022-01836-y
- **License:** Creative Commons Attribution 4.0 International (**CC BY 4.0**)
- **Modifications / Transformations Applied:**
  - Only a single compact replay segment is embedded (`F1` physical channel selected unchanged -> converted to microvolts as `float32`, assembled as rest 5 s -> active 5 s -> rest 5 s, totaling `30,720` samples at `2048 Hz`).
  - The full PhysioNet GRABMyo dataset is **not** distributed in this repository.
  - All downstream 20–450 Hz digital filtering and contraction threshold choices are project choices, not diagnostic or efficacy claims from the GRABMyo authors.

---

## 3. DejaVu Fonts (`DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`)

- **Integrated location in repository:**
  - `web/public/fonts/DejaVuSans.ttf`
  - `web/public/fonts/DejaVuSans-Bold.ttf`
- **Purpose:** Full Unicode Vietnamese glyph embedding in generated PDF workout reports (`pdf-lib` + `@pdf-lib/fontkit`).
- **Source package:** `dejavu-fonts-ttf` (`v2.37.3`)
- **License:** DejaVu Changes in Public Domain / Bitstream Vera Fonts Copyright / Arev Fonts Copyright

```text
Fonts are (c) Bitstream (see below). DejaVu changes are in public domain.
Glyphs imported from Arev fonts are (c) Tavmjong Bah (see below)

Bitstream Vera Fonts Copyright
------------------------------

Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera is
a trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of the fonts accompanying this license ("Fonts") and associated
documentation files (the "Font Software"), to reproduce and distribute the
Font Software, including without limitation the rights to use, copy, merge,
publish, distribute, and/or sell copies of the Software, and to permit
persons to whom the Font Software is furnished to do so, subject to the
following conditions:

The above copyright notice and trademark notices and this permission notice
shall be included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular
the designs of glyphs or characters in the Fonts may be modified and
additional glyphs or characters may be added to the Fonts, only if the fonts
are renamed to names not containing either the words "Bitstream" or the word
"Vera".

This License becomes null and void to the extent applicable to Fonts or Font
Software that has been modified and is distributed under the "Bitstream
Vera" names.

The Font Software may be sold as part of a larger software package but no
copy of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME
FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING
ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE
FONT SOFTWARE.

Except as contained in this notice, the names of Gnome, the Gnome
Foundation, and Bitstream Inc., shall not be used in advertising or
otherwise to promote the sale, use or other dealings in this Font Software
without prior written authorization from the Gnome Foundation or Bitstream
Inc., respectively. For further information, contact: fonts at gnome dot
org.

Arev Fonts Copyright
------------------------------

Copyright (c) 2006 by Tavmjong Bah. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a
copy of the fonts accompanying this license ("Fonts") and associated
documentation files (the "Font Software"), to reproduce and distribute the
modifications to the Bitstream Vera Font Software, including without
limitation the rights to use, copy, modify, merge, publish, distribute,
and/or sell copies of the Font Software, and to permit persons to whom the
Font Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular
the designs of glyphs or characters in the Fonts may be modified and
additional glyphs or characters may be added to the Fonts, only if the fonts
are renamed to names not containing either the words "Tavmjong Bah" or the
word "Arev".

This License becomes null and void to the extent applicable to Fonts or Font
Software that has been modified and is distributed under the
"Tavmjong Bah Arev" names.

The Font Software may be sold as part of a larger software package but no
copy of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL TAVMJONG BAH BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL,
INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
FONT SOFTWARE OR THE USE OR OTHER DEALINGS IN THE FONT SOFTWARE.

Except as contained in this notice, the name of Tavmjong Bah shall not
be used in advertising or otherwise to promote the sale, use or other
dealings in this Font Software without prior written authorization
from Tavmjong Bah. For further information, contact: tavmjong @ free
. fr.
```
