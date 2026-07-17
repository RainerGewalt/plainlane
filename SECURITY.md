# Security

## Supported version

Security fixes are applied to the latest release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue for an unpatched vulnerability or include real board data, API keys, attachments, or database files in a report.

## Deployment model

Plainlane is designed for a trusted local network. It has no authentication or user isolation. Anyone who can reach the exposed NGINX port can read and modify all application data.

- Do not expose Plainlane directly to the public internet.
- Use a firewall, VPN, localhost binding, or an authenticated reverse proxy.
- Keep `.env`, the SQLite volume, and exported JSON backups private.
- Rotate an OpenAI API key immediately if it is ever exposed.
- Back up data before upgrading.
