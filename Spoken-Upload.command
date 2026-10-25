#!/bin/sh
# macOS: Doppelklick startet das Fenster (Python 3 von python.org vorausgesetzt).
cd "$(dirname "$0")" && exec python3 Spoken-Upload.pyw "$@"
