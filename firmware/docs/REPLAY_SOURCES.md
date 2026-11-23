# Sources and attribution

This attribution record is retained from v0.1. Paths under `analysis/` below
refer to that original package. In v0.2, regression results are in `validation/`
and original recording metadata is in `data/metadata.json`.

Input files were provided by the user, unchanged, from GRABMyo v1.1.0:
https://physionet.org/content/grabmyo/1.1.0/

Jiang, N., Pradhan, A., & He, J. (2024). Gesture Recognition and Biometrics
ElectroMyogram (GRABMyo), version 1.1.0. PhysioNet.
https://doi.org/10.13026/89dm-f662

Original publication: Pradhan, A., He, J. & Jiang, N. Multi-day dataset of forearm
and wrist electromyogram for hand gesture recognition and biometrics.
Scientific Data 9, 733 (2022). https://doi.org/10.1038/s41597-022-01836-y

The v1.1.0 landing page specifies CC BY 4.0. The provided historical readme
mentions Open Data Commons Attribution v1.0; retain the source documentation and
refer to the version's LICENSE.txt for licensing. Generated software does not
change the licensing of original or derived data. No endorsement is implied.

Derived files: main/replay_data.c (F1 -> microvolts -> float32),
analysis/python_reference.csv, analysis/host_results.csv, analysis/replay_preview.png.
The sequence repeats the same rest record at the end. It is deliberately assembled,
not a single naturally recorded contraction. Original headers/data are in data/.
Input SHA-256 values are recorded in analysis/metadata.json.

F1 is selected unchanged from the published physical-signal channels, following
the author's Python conversion script (which selects F1..F16, rather than applying
another channel subtraction):
https://physionet.org/content/grabmyo/1.1.0/grabmyo_convert_wfdb_to_mat.py
Electrode locations do not establish the exact muscle identity of channel F1.
We do not label it as a specific flexor, nor use it as biceps data.

WFDB format 16 definition (signed 16-bit, little endian, sample-interleaved):
https://physionet.org/physiotools/wag/signal-5.htm

ESP-IDF ESP Timer task-dispatch callback, deferred computation:
https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/esp_timer.html

Implementation assumptions: ESP-IDF 6.1 on ESP32-S3. The DSP core is standard C11.
The 20-450 Hz digital bandpass and all threshold/duration settings are proposed
prototype choices. They are not efficacy or diagnostic claims from GRABMyo.

UI 0.2.0 package note: this compact package retains the derived replay arrays and this attribution. Original raw recordings and the older analysis directories are not included. The UI now defaults to ESP32-WROOM, SSD1306; DSP data and conversion are unchanged.
