═══════════════════════════════════════════════════════════════
  SOUNDONLY + AUDIO PANEL — Guide de déploiement
═══════════════════════════════════════════════════════════════

PRÉREQUIS
─────────
  Serveur Minecraft :
    - Paper 1.21.x
    - Simple Voice Chat (voicechat-bukkit-2.6.17.jar ou +)
    - WorldGuard + WorldEdit (optionnel, pour filtrage par région)

  Machine hébergeant le panel :
    - Node.js 18+
    - FFmpeg installé (apt install ffmpeg)
    - Accès réseau vers le port WebSocket du serveur Minecraft


═══════════════════════════════════════════════════════════════
  PARTIE 1 — PLUGIN MINECRAFT (SoundOnly)
═══════════════════════════════════════════════════════════════

1. COMPILATION
──────────────
  Prérequis : Java 21, Maven 3.8+

  a) Placer voicechat-bukkit-2.6.17.jar dans le dossier lib/ :
       final_plugin/lib/voicechat-api-2.6.17.jar

  b) Installer le jar dans le cache Maven local :
       mvn install:install-file \
         -Dfile=lib/voicechat-api-2.6.17.jar \
         -DgroupId=de.maxhenkel.voicechat \
         -DartifactId=voicechat-api \
         -Dversion=2.6.17 \
         -Dpackaging=jar

     OU simplement compiler directement (le pom.xml utilise
     le dossier lib/ local via <scope>system</scope>) :
       cd final_plugin
       mvn package -q

  c) Le jar compilé se trouve dans :
       final_plugin/target/SoundOnly-1.0.0.jar


2. INSTALLATION
───────────────
  a) Copier SoundOnly-1.0.0.jar dans le dossier plugins/ du
     serveur Minecraft.

  b) S'assurer que ces plugins sont aussi présents :
       - voicechat-bukkit-2.6.17.jar (ou version compatible)
       - worldguard-bukkit-7.x.x.jar (optionnel)
       - worldedit-bukkit-7.x.x.jar  (optionnel)

  c) Démarrer le serveur — les fichiers de config sont générés
     automatiquement dans plugins/SoundOnly/


3. CONFIGURATION  (plugins/SoundOnly/config.yml)
─────────────────────────────────────────────────
  websocket:
    address: "0.0.0.0"   # écoute sur toutes les interfaces
    port: 8765            # port WebSocket — doit être ouvert
                          # dans le pare-feu du VPS

  worldguard:
    enabled: false        # true = seuls les joueurs dans les
                          # régions listées entendent le son
    regions:
      - main_stage        # IDs des régions WorldGuard
    allow-if-missing: true
    bypass-permission: "soundonly.worldguard.bypass"


4. OUVERTURE DU PORT PARE-FEU
──────────────────────────────
  Le panel Node.js doit pouvoir atteindre le port WebSocket
  (8765 par défaut).

  Si le panel est sur la même machine que Minecraft :
    → pas besoin d'ouvrir le port en externe

  Si le panel est sur une autre machine :
    # UFW
    ufw allow 8765/tcp

    # iptables
    iptables -A INPUT -p tcp --dport 8765 -j ACCEPT

    # OVH / firewall cloud : ajouter une règle TCP entrante
    # sur le port 8765 dans le manager OVH


5. COMMANDES IN-GAME
─────────────────────
  /soundonly status   → état du WebSocket, streaming, clients
  /soundonly stop     → arrête le stream en cours
  /soundonly reload   → recharge config.yml sans redémarrer

  Permission requise : soundonly.control (op par défaut)


═══════════════════════════════════════════════════════════════
  PARTIE 2 — PANEL WEB (audio-panel)
═══════════════════════════════════════════════════════════════

1. INSTALLATION
───────────────
  a) Copier le dossier final_panel/ sur le serveur hébergeant
     le panel.

  b) Installer les dépendances :
       cd final_panel
       npm install

  c) Créer le fichier .env à partir de l'exemple :
       cp .env.example .env
       nano .env


2. CONFIGURATION  (.env)
─────────────────────────
  PANEL_PORT=3000
    → Port HTTP du panel web (accessible depuis le navigateur)

  PANEL_PASSWORD=mon-mot-de-passe
    → Mot de passe pour accéder au panel
    → Choisir quelque chose de solide si le panel est exposé

  MC_WS_URL=ws://127.0.0.1:8765
    → URL WebSocket du plugin Minecraft
    → Si panel et Minecraft sont sur la même machine :
         ws://127.0.0.1:8765
    → Si sur des machines différentes :
         ws://<IP-DU-SERVEUR-MINECRAFT>:8765


3. LANCEMENT
────────────
  # Lancement simple
  npm start

  # Lancement en arrière-plan avec PM2 (recommandé)
  npm install -g pm2
  pm2 start server.js --name audio-panel
  pm2 save
  pm2 startup   # pour démarrage automatique au boot


4. ACCÈS AU PANEL
──────────────────
  Depuis un navigateur :
    http://<IP-DU-VPS>:3000

  Si le port 3000 est bloqué par le pare-feu :
    ufw allow 3000/tcp

  Recommandé en production : mettre un reverse proxy Nginx
  devant le panel avec HTTPS (certbot).


5. STRUCTURE DES DOSSIERS
──────────────────────────
  final_panel/
  ├── server.js          → serveur Node.js principal
  ├── .env               → configuration (à créer)
  ├── .env.example       → modèle de configuration
  ├── package.json
  ├── music/             → dossier des fichiers audio uploadés
  ├── playlists.json     → sauvegarde des playlists (auto-créé)
  └── public/
      └── index.html     → interface web


═══════════════════════════════════════════════════════════════
  SCHÉMA DE FONCTIONNEMENT
═══════════════════════════════════════════════════════════════

  [Fichier MP3 / Flux Icecast]
          │
          ▼
  [FFmpeg] → PCM 16-bit mono 48kHz
          │
          ▼
  [Panel Node.js] → frames base64 via WebSocket
          │
          ▼
  [Plugin SoundOnly] → encodage Opus (mode AUDIO)
          │
          ▼
  [Simple Voice Chat] → diffusion à chaque joueur connecté


═══════════════════════════════════════════════════════════════
  DÉPANNAGE
═══════════════════════════════════════════════════════════════

  Problème : "Plugin : erreur" dans le panel
  → Vérifier que le serveur Minecraft tourne
  → Vérifier MC_WS_URL dans .env
  → Vérifier que le port 8765 est ouvert
  → Vérifier dans les logs Minecraft :
      [SoundOnly] WebSocket démarré sur 0.0.0.0:8765

  Problème : Pas de son en jeu
  → Vérifier que Simple Voice Chat est connecté (icône en jeu)
  → Vérifier dans les logs Minecraft :
      [SoundOnly] Session audio ouverte pour <pseudo>
  → OpenAudioMc ou un plugin similaire peut interférer
      → désactiver OpenAudioMc si présent

  Problème : Son saccadé
  → FFmpeg doit tourner en continu sans interruption
  → Vérifier que le réseau entre panel et Minecraft est stable
  → Éviter de relancer trop rapidement après un stop

  Problème : FFmpeg code 255
  → Normal si c'est suite à un clic sur Stop (arrêt volontaire)
  → Anormal si c'est immédiatement au lancement :
      vérifier que le fichier audio existe dans music/

  Problème : Compilation Maven échoue sur voicechat-api
  → Télécharger voicechat-bukkit-2.6.17.jar depuis Modrinth
  → Le placer dans final_plugin/lib/voicechat-api-2.6.17.jar
  → Relancer mvn package -q

═══════════════════════════════════════════════════════════════
