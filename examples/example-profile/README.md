# Example profile

Reference layout for a dsh profile that composes `@deepseek-ai/dsh-base` with
the `dsh-bookkeeping` bundle, plus a profile-level config override.

## Usage (recommended)

Profiles live under `$DSH_HOME/profiles/` (default `~/.dsh/profiles/`), and the
supported way to create one is through the dsh CLI, which initializes the
profile directory (workspace manifest, base bundle, …) for you:

1. Build the bundle first (from the repository root):

   ```sh
   npm install
   npm run build
   ```

2. Create the profile and add the bundle:

   ```sh
   dsh plugin --profile bookkeeping-demo add <path/to/dsh-bookkeeping>
   # or from a packed tarball: dsh plugin --profile bookkeeping-demo add ./dsh-bookkeeping-1.0.0.tgz
   ```

3. Optionally override the plugin config by editing
   `~/.dsh/profiles/bookkeeping-demo/cordis.patch.yml` — the `cordis.patch.yml`
   in this directory shows the shape of such an override (id-targeted, whole
   `config` replacement; `currency` here; see the README for all keys).

4. Boot:

   ```sh
   dsh --profile bookkeeping-demo
   ```

The `package.json` in this directory is the reference shape `dsh plugin` writes
(the `dsh.profile.bundles` list plus the bundle dependency); do not copy it
over an existing profile — use the CLI commands above instead.
