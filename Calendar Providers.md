# Calendar Providers

See [[Google Calendar]], [[Outlook Calendar]], and [[code-notes]].

Each calendar integration is an isolated provider. Shared code owns temporal projection, display-window filtering, the clock UI, and publication; a provider owns only site-specific discovery and evidence.

## Required contract

1. Add immutable metadata to `src/providers/provider-registry.js`.
2. Put the adapter, shared provider contracts, and optional parsers in `src/content/providers/<provider>/`. Declare MAIN-world dependencies in registry order when a parser needs them.
3. Export `createCalendarClockProvider(definition)` from the adapter. It must provide `readEventNode`; structured capture and page-local presence evidence are optional capabilities.
4. Add a provider-owned background snapshot module only when its storage or validation differs from the shared Google feed.
5. Add the provider origin to the Manifest host permissions, content-script matches, and web-accessible-resource matches.
6. Verify the shared temporal contract plus provider-specific fixtures.

Deleting an optional provider folder must degrade only that integration. The registry-driven loaders skip a missing adapter or background module without disabling Google or another provider.

Canonical records and the shared temporal contract cross provider boundaries. A DOM-presence capability may only produce ephemeral suppression evidence; persisted feeds must remain fail-open.
