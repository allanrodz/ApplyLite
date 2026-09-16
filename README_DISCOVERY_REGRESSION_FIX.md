# ApplyLite M10.2 Windows regression cleanup fix

Fixes `npm run regression:discovery` failing on Windows with `EPERM` while deleting its temporary SQLite directory.

The regression now explicitly checkpoints and closes the better-sqlite3 database before removing the temp directory, and uses bounded Windows retry handling.

No runtime discovery logic, database schema, Gmail integration, or user data is changed.
