# Port Bridge Remote

Remote-side endpoint for Local Port Bridge. Install it together with
`lwmacct.port-bridge-local`.

This extension must run in the remote workspace extension host. It validates the
actual runtime host during activation and stops if it is running locally or in a
non-remote window.
