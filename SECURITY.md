# Security

## Supported version

Security fixes are applied to the latest release.

## Reporting a vulnerability

Do not describe a suspected vulnerability in a public issue, pull request, or discussion.

If the **Security** tab of this repository offers **Report a vulnerability**, use it: GitHub's private vulnerability reporting shows the report only to you and the maintainer. If that option is not available, open an issue that only asks for a private contact and contains no details about the problem; the details are then exchanged privately.

Never include real board data, API keys, attachments, or database files in a report.

## Deployment model

Plainlane has no authentication or user isolation. Its safe default binds the browser port to `127.0.0.1`, so only the computer running Docker can reach it. Anyone who can reach a deliberately exposed NGINX port can read and modify all application data.

- Do not expose Plainlane directly to the public internet.
- Keep the default localhost binding unless LAN access is intentional.
- For a trusted LAN, set `PLAINLANE_BIND_ADDRESS=0.0.0.0` and use a firewall.
- For remote access, use a VPN or authenticated reverse proxy.
- Keep `.env`, the SQLite volume, and exported JSON backups private.
- Rotate an OpenAI API key immediately if it is ever exposed.
- Use `./start.sh update`; it creates a database backup before pulling or migrating.
