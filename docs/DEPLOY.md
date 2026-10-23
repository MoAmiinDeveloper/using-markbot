# Deploying Somtel Fleet to a cloud server

One Ubuntu server runs everything: the Teltonika gateway, the web app, the database and HTTPS.

## 1. Create the server

Any provider works. Pick **Ubuntu 24.04**, at least **1 vCPU / 2 GB RAM / 20 GB disk**
(1 GB works too; the installer adds swap). Examples: Hetzner CX22, DigitalOcean Basic 2 GB,
Contabo VPS S. Choose the region closest to your vehicles.

Nothing else is needed — no domain. The installer serves the app on
`https://<server-ip-with-dashes>.sslip.io` with a free certificate. If you have a domain, point an
`A` record at the server IP and pass `DOMAIN=fleet.example.com`.

If your provider has its own firewall (DigitalOcean/Hetzner cloud firewall, AWS security group),
allow inbound **TCP 22, 80, 443, 5027** and **UDP 5027**.

## 2. Install (one command)

SSH in as root (`ssh root@SERVER_IP`) and run:

```sh
curl -fsSL https://raw.githubusercontent.com/MoAmiinDeveloper/using-markbot/claude/fleet-tracking-management-xli9z8/scripts/cloud/install.sh -o install.sh
sudo bash install.sh
```

If the repository is private, the download above needs a token; instead run:

```sh
git clone -b claude/fleet-tracking-management-xli9z8 https://<GITHUB_TOKEN>@github.com/MoAmiinDeveloper/using-markbot.git /opt/fleet
sudo REPO_URL=https://<GITHUB_TOKEN>@github.com/MoAmiinDeveloper/using-markbot.git bash /opt/fleet/scripts/cloud/install.sh
```

It takes ~5–10 minutes and ends with the web address, the admin login and the generated
password (also stored in `/etc/fleet/initial-admin-password` — change it under Settings → Account).

## 3. Point an FMB920 at the server

**Teltonika Configurator** (USB) → *GPRS* tab → *Server settings*:

| Field | Value |
|---|---|
| Domain | your server IP (e.g. `203.0.113.10`) |
| Port | `5027` |
| Protocol | `TCP` |

Also check the SIM's **APN** in the same tab, and *System → Data protocol* = **Codec 8 Extended**.
Save to device.

**Or by SMS** to the device's SIM (two spaces at the start when no SMS login/password is set):

```
  setparam 2004:203.0.113.10;2005:5027;2006:0
```

(2004 = server domain/IP, 2005 = port, 2006 = protocol, 0 = TCP.)

The device appears in **Live Map** within a minute, named `Device <last 6 IMEI digits>` —
rename it under **Devices**. Commands such as **Engine stop** work because the device is
connected directly.

## Operations

| Task | Command |
|---|---|
| Live logs | `journalctl -u fleetd -f` |
| Restart | `sudo systemctl restart fleetd` |
| Update to latest | `sudo bash /opt/fleet/scripts/cloud/update.sh` |
| Settings | `/etc/fleet/fleet.env` then restart |
| Demo vehicles | `sudo -u fleet /opt/fleet/server/bin/simulator -devices 10` |
| Database backup | `sudo -u postgres pg_dump fleet \| gzip > fleet-$(date +%F).sql.gz` |
