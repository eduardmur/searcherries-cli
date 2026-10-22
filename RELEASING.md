# Releasing

## First release (once)

1. Create the public GitHub repository `eduardmur/searcherries-cli` and push `main`. CI runs biome, the typecheck and the tests on Linux, macOS and Windows with Node 20 and 22.
2. Publish 0.1.0 from your machine. npm trusted publishing can only be set up for a package that already exists, so the first version goes out by hand:

   ```bash
   npm login
   npm publish --access public
   ```

   npm asks for the 2FA code. `prepublishOnly` builds `dist/` first.
3. On npmjs.com, open the package, then **Settings**, **Trusted publishing**, and add GitHub Actions with owner `eduardmur`, repository `searcherries-cli`, workflow `release.yml`, no environment.
4. Check the homepage link: https://searcherries.com/docs/api/cli must be live (the page is in the marketing repository's `docs/public/{en,es}/api/cli.md`).

## Every later release

1. Bump `version` in `package.json` (`npm version patch --no-git-tag-version`), commit.
2. Tag and push: `git tag v0.1.1 && git push origin main --tags`.

`release.yml` checks that the tag matches `package.json`, runs the checks, publishes with provenance and creates the GitHub release.

## When the API changes

`src/commands.ts` maps each flag to a REST API v1 query parameter. A new endpoint or parameter needs a command or an option there, a test in `test/cli.test.ts`, the README and the docs page (`docs/public/en/api/cli.md` in the app repository, mirrored with Spanish in the marketing repository). New allowed values of an existing parameter need nothing: the CLI passes values through and shows the API's validation errors.
