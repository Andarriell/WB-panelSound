# Minecraft Audio Panel

Panel web pour envoyer un fichier audio ou un flux OBS/Icecast vers le plugin Minecraft SoundOnly.

## Installation Debian 12

```bash
sudo apt update
sudo apt install nodejs npm ffmpeg unzip -y
cd /home/deploy
unzip audio-panel.zip
cd audio-panel
npm install
```

## Lancement

```bash
PANEL_PASSWORD="ton_mot_de_passe" MC_WS_URL="ws://127.0.0.1:8765" npm start
```

Puis ouvre :

```txt
http://IP_DU_VPS:3000
```

## Ports

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 8765/tcp
sudo ufw allow 24454/udp
sudo ufw reload
```

## OBS

OBS ne sort pas directement en WebSocket. Utilise plutôt :

OBS -> Icecast -> URL dans le panel -> Minecraft

Exemple d'URL :

```txt
http://IP_DU_VPS:8000/live
```
