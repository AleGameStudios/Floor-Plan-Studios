# my-data (optional)

Designs, settings and view preferences placed here are bundled into the installer
(`extraResources` in `package.json`) and imported on first launch on another computer.
The contents of this folder are git-ignored, so personal designs never reach the repository.

Layout:

```
my-data/
  bundle.json         { "stamp": "<any new value>" }  each new stamp is imported once
  settings.json       app settings to carry over (local settings win)
  preferences.json    view preferences (theme, detail, lens, ...)
  designs/*.fpdesign  designs to copy in (only missing or older ones are replaced)
```

Leave the folder empty to build an installer with no bundled data.
