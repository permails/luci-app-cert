# luci-app-cert

`luci-app-cert` is an OpenWrt LuCI application for automated ACME certificate issuance, renewal, and deployment. It bundles `acme.sh` and its DNS API provider scripts into a single self-contained package (`cert` service) with no external ACME daemon or DNS provider package dependencies.

## Features

- **Challenge Modes**: Supports DNS-01, Webroot, Standalone HTTP, and TLS-ALPN validation.
- **Integrated DNS Providers**: Dynamically parses bundled `dnsapi` metadata with searchable provider selection, credential validation, and optional DDNS configuration import.
- **Multi-Target Deployment**: Deploys issued certificates to custom OpenWrt service paths via atomic file copy or symlink with configurable post-install reload commands, plus native `luci-nginx` SSL binding.
- **Service & Renewal Lifecycle**: Provides service enable/stop controls, manual issuance, forced renewal, task abort, scheduled cron renewal, and online `acme.sh` / `dnsapi` updates.
- **Unified Logging**: Tags all plugin output and errors with `cert` across system syslog and `/var/run/cert/cert.log`, with severity configuration (`err`, `warn`, `info`, `debug`) and a filtered log viewer.

## Dependencies

- `luci-base`
- `wget-ssl`
- `ca-bundle`
- `openssl-util`
- `socat`

Compatible with OpenWrt 23.05 and 25.12+.

## Build

Place this directory under `package/luci-app-cert` in an OpenWrt buildroot tree and compile:

```sh
make package/luci-app-cert/compile V=s
```

## Runtime Paths

- Configuration: `/etc/config/cert`
- Service script: `/etc/init.d/cert`
- ACME account and state: `/etc/cert/acme`
- Standard certificate symlinks: `/etc/ssl/cert`
- Plugin log mirror: `/var/run/cert/cert.log`

## License

GPL-3.0-or-later

## Author

permails <logo@permails.com>

Repository: https://github.com/permails/luci-app-cert
